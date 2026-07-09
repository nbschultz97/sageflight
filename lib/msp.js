// MSP v1 protocol: frame encode + decode for Betaflight serial communication.
// Ref: https://github.com/betaflight/betaflight/wiki/MultiWii-Serial-Protocol
//
// Frame: $ M <dir> <size> <cmd> <payload...> <crc>
//   preamble: '$' 'M'
//   dir: '<' (to FC) or '>' (from FC)
//   size: 1 byte — payload size
//   cmd:  1 byte — MSP command id
//   payload: size bytes
//   crc: XOR of size, cmd, and all payload bytes

const PREAMBLE = Buffer.from([0x24, 0x4d]); // '$', 'M'
const DIR_OUT = 0x3c; // '<'
const DIR_IN  = 0x3e; // '>'

function encode(cmd, payload = Buffer.alloc(0)) {
  if (payload.length > 255) throw new Error(`MSP v1 payload too large: ${payload.length} (max 255)`);
  const frame = Buffer.alloc(6 + payload.length);
  frame[0] = 0x24; // '$'
  frame[1] = 0x4d; // 'M'
  frame[2] = DIR_OUT;
  frame[3] = payload.length;
  frame[4] = cmd;
  payload.copy(frame, 5);
  let crc = frame[3] ^ frame[4];
  for (let i = 0; i < payload.length; i++) crc ^= payload[i];
  frame[5 + payload.length] = crc;
  return frame;
}

// Parser state machine — stream-friendly for serial port 'data' events.
// Handles MSP v1 "jumbo" frames (size byte 255 → real u16 length leads the
// payload) — the FC uses them for large replies like dataflash reads.
function createParser(onFrame) {
  let state = 'preamble1';
  let size = 0, cmd = 0, dir = 0;
  let payload = null;
  let payloadIdx = 0;
  let crc = 0;

  return function feed(buf) {
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      switch (state) {
        case 'preamble1': if (b === 0x24) state = 'preamble2'; break;
        case 'preamble2': state = b === 0x4d ? 'dir' : 'preamble1'; break;
        case 'dir':
          if (b === DIR_IN || b === DIR_OUT) { dir = b; state = 'size'; }
          else state = 'preamble1';
          break;
        case 'size':
          size = b; crc = b;
          state = 'cmd';
          break;
        case 'cmd':
          cmd = b; crc ^= b;
          if (size === 255) { state = 'jumboLo'; }        // real length follows
          else if (size === 0) { state = 'crc'; }
          else { payload = Buffer.alloc(size), payloadIdx = 0; state = 'payload'; }
          break;
        case 'jumboLo':
          size = b; crc ^= b;
          state = 'jumboHi';
          break;
        case 'jumboHi':
          size |= b << 8; crc ^= b;
          if (size === 0) { state = 'crc'; }
          else { payload = Buffer.alloc(size); payloadIdx = 0; state = 'payload'; }
          break;
        case 'payload':
          payload[payloadIdx++] = b; crc ^= b;
          if (payloadIdx === size) state = 'crc';
          break;
        case 'crc':
          if (b === crc) onFrame({ cmd, dir, payload: payload || Buffer.alloc(0) });
          // else: silently drop corrupt frame
          state = 'preamble1'; payload = null;
          break;
      }
    }
  };
}

// Well-known MSP command IDs we'll need.
const MSP = {
  API_VERSION:    1,
  FC_VARIANT:     2,
  FC_VERSION:     3,
  STATUS:       101,
  REBOOT:        68, // Soft-reboot the FC. Useful to cleanly restore DShot output after 4-way.
  DATAFLASH_SUMMARY: 70, // flags + sector count + total/used bytes of the blackbox flash chip
  DATAFLASH_READ:    71, // read a chunk: u32 addr + u16 size + u8 allowCompression
  DATAFLASH_ERASE:   72, // full chip erase — destructive, takes tens of seconds
  SET_4WAY_IF:  245, // Enter BLHeli 4-way passthrough. Returns 1 byte: number of connected ESCs.
};

module.exports = { encode, createParser, MSP };
