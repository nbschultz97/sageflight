// BLHeli 4-way interface protocol.
// Ref: https://github.com/bitdump/BLHeli/blob/master/Interfaces/4w%20if/4wif.pdf
//      https://github.com/blheli-configurator/blheli-configurator/blob/master/src/js/msp/index.js
//
// Frame (host → interface):
//   [0x2f] [cmd] [addrHi] [addrLo] [paramLen] [param...] [crcHi] [crcLo]
//   paramLen=0 is encoded as 0x00 (meaning 256). Empty params -> 1-byte 0xff? Check per impl.
//   Actually: per-spec, if n==0 it means 256 bytes.
//
// Frame (interface → host):
//   [0x2e] [cmd] [addrHi] [addrLo] [paramLen] [param...] [ack] [crcHi] [crcLo]
//
// CRC: CRC-16-XMODEM (poly 0x1021, init 0x0000), computed over all bytes from start up to CRC.

const CMD = {
  INTERFACE_TEST_ALIVE: 0x30,
  PROTOCOL_GET_VERSION: 0x31,
  INTERFACE_GET_NAME:   0x32,
  INTERFACE_GET_VERSION:0x33,
  INTERFACE_EXIT:       0x34,
  DEVICE_RESET:         0x35,
  DEVICE_INIT_FLASH:    0x37,
  DEVICE_ERASE_ALL:     0x38,
  DEVICE_PAGE_ERASE:    0x39,
  DEVICE_READ:          0x3a,
  DEVICE_WRITE:         0x3b,
  DEVICE_C2CK_LOW:      0x3c,
  DEVICE_READ_EEPROM:   0x3d,
  DEVICE_WRITE_EEPROM:  0x3e,
  INTERFACE_SET_MODE:   0x3f,
};

const ACK = {
  OK:                       0x00,
  I_UNKNOWN_ERROR:          0x01,
  I_INVALID_CMD:            0x02,
  I_INVALID_CRC:            0x03,
  I_VERIFY_ERROR:           0x04,
  D_INVALID_COMMAND:        0x05,
  D_COMMAND_FAILED:         0x06,
  D_UNKNOWN_ERROR:          0x07,
  I_INVALID_CHANNEL:        0x08,
  I_INVALID_PARAM:          0x09,
  D_GENERAL_ERROR:          0x0f,
};

// CRC-16-XMODEM (poly 0x1021, init 0x0000, no reflection, no xorout)
function crc16(data) {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = (crc ^ (data[i] << 8)) & 0xffff;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function buildFrame(cmd, addr = 0, param = Buffer.from([0])) {
  if (param.length > 256) throw new Error(`4-way param too large: ${param.length}`);
  // Per spec and reference impl (betaflight-configurator fourWay.js): paramLen=0 means 256 bytes.
  // For commands with no meaningful param, we send a single dummy byte [0x00] and paramLen=1.
  const paramLen = param.length === 256 ? 0 : param.length;
  const body = Buffer.alloc(5 + param.length);
  body[0] = 0x2f;
  body[1] = cmd;
  body[2] = (addr >> 8) & 0xff;
  body[3] = addr & 0xff;
  body[4] = paramLen;
  param.copy(body, 5);
  const crc = crc16(body);
  const frame = Buffer.alloc(body.length + 2);
  body.copy(frame, 0);
  frame[body.length]     = (crc >> 8) & 0xff;
  frame[body.length + 1] = crc & 0xff;
  return frame;
}

// Stream parser: reads 4-way responses, calls onFrame({ cmd, addr, param, ack }) or onError.
function createParser(onFrame, onError = () => {}) {
  let buf = Buffer.alloc(0);
  return function feed(chunk) {
    buf = Buffer.concat([buf, chunk]);
    // Try to parse starting from first 0x2e
    while (buf.length > 0) {
      const start = buf.indexOf(0x2e);
      if (start < 0) { buf = Buffer.alloc(0); return; }
      if (start > 0) buf = buf.slice(start);
      // Need at least 5 header bytes to know paramLen
      if (buf.length < 5) return;
      const cmd = buf[1], addrHi = buf[2], addrLo = buf[3], paramLen = buf[4];
      const payloadLen = paramLen === 0 ? 256 : paramLen;
      const totalLen = 5 + payloadLen + 1 + 2; // hdr + param + ack + crc(2)
      if (buf.length < totalLen) return;
      const param = buf.slice(5, 5 + payloadLen);
      const ack = buf[5 + payloadLen];
      const crcGiven = (buf[5 + payloadLen + 1] << 8) | buf[5 + payloadLen + 2];
      const crcCalc = crc16(buf.slice(0, 5 + payloadLen + 1));
      if (crcGiven !== crcCalc) {
        onError(new Error(`4-way CRC mismatch: got 0x${crcGiven.toString(16)}, expected 0x${crcCalc.toString(16)}`));
        buf = buf.slice(1); // skip this start byte, hunt for next
        continue;
      }
      onFrame({ cmd, addr: (addrHi << 8) | addrLo, param, ack });
      buf = buf.slice(totalLen);
    }
  };
}

// High-level transaction helper: send command, await response matching cmd, with timeout.
function transact(port, parser, onFrameRegister, cmd, addr = 0, param = Buffer.alloc(0), timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onFrameRegister(null);
      reject(new Error(`4-way command 0x${cmd.toString(16)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    onFrameRegister((frame) => {
      if (frame.cmd !== cmd) return false; // not ours, keep listening
      clearTimeout(timeout);
      onFrameRegister(null);
      if (frame.ack !== ACK.OK) {
        reject(new Error(`4-way cmd 0x${cmd.toString(16)} NACK: ack=0x${frame.ack.toString(16)}`));
      } else {
        resolve(frame);
      }
      return true;
    });
    port.write(buildFrame(cmd, addr, param));
  });
}

module.exports = { CMD, ACK, crc16, buildFrame, createParser, transact };
