// Intel HEX parser — turns a Betaflight release .hex into a flat binary image
// plus its base address, ready for `dfu-util -s <addr>:leave -D image.bin`.
//
// Record: :LLAAAATT[DD...]CC
//   LL len, AAAA 16-bit addr, TT type, DD data, CC checksum (two's complement
//   of the sum of all preceding bytes).
// Types handled: 00 data, 01 EOF, 02 extended segment (<<4), 04 extended
// linear (<<16), 03/05 start-address records (recorded, not part of image).

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // no FC firmware is anywhere near 8MB

function parseIntelHex(text) {
  const lines = String(text || '').split(/\r?\n/);
  let upper = 0;             // bits 31..16 from type-04 (or <<4 offset from type-02)
  let segmentOffset = 0;     // type-02 contribution
  let eof = false;
  let startAddress = null;   // from type-03/05, informational
  const chunks = [];         // { address, data }

  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line) continue;
    if (!line.startsWith(':')) throw new Error(`line ${ln + 1}: missing ':' record start`);
    if (eof) throw new Error(`line ${ln + 1}: data after EOF record`);
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length % 2 === 0) {
      throw new Error(`line ${ln + 1}: not valid hex`);
    }
    const bytes = Buffer.from(line.slice(1), 'hex');
    if (bytes.length < 5) throw new Error(`line ${ln + 1}: record too short`);
    const len = bytes[0];
    if (bytes.length !== 5 + len) throw new Error(`line ${ln + 1}: length field ${len} does not match record size`);

    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`line ${ln + 1}: checksum mismatch`);

    const addr16 = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.slice(4, 4 + len);

    switch (type) {
      case 0x00: {
        const address = (upper << 16) + segmentOffset + addr16;
        chunks.push({ address, data });
        break;
      }
      case 0x01:
        eof = true;
        break;
      case 0x02:
        if (len !== 2) throw new Error(`line ${ln + 1}: bad extended-segment record`);
        segmentOffset = ((data[0] << 8) | data[1]) << 4;
        upper = 0;
        break;
      case 0x04:
        if (len !== 2) throw new Error(`line ${ln + 1}: bad extended-linear record`);
        upper = (data[0] << 8) | data[1];
        segmentOffset = 0;
        break;
      case 0x03:
      case 0x05:
        startAddress = data.readUIntBE(0, data.length);
        break;
      default:
        throw new Error(`line ${ln + 1}: unsupported record type 0x${type.toString(16)}`);
    }
  }

  if (!eof) throw new Error('no EOF record — file truncated?');
  if (chunks.length === 0) throw new Error('no data records');

  chunks.sort((a, b) => a.address - b.address);
  const base = chunks[0].address;
  const last = chunks[chunks.length - 1];
  const span = last.address + last.data.length - base;
  if (span <= 0 || span > MAX_IMAGE_BYTES) {
    throw new Error(`image span ${span} bytes is implausible for FC firmware`);
  }

  // Flatten into one image; gaps between records are 0xff (erased-flash value).
  const image = Buffer.alloc(span, 0xff);
  let dataBytes = 0;
  for (const c of chunks) {
    c.data.copy(image, c.address - base);
    dataBytes += c.data.length;
  }

  return {
    baseAddress: base,
    baseAddressHex: '0x' + base.toString(16).padStart(8, '0'),
    startAddress,
    totalBytes: span,
    dataBytes,
    image,
  };
}

module.exports = { parseIntelHex, MAX_IMAGE_BYTES };
