// IEEE CRC-32, shared by PNG validation on every supported Node.js version.
const table = new Uint32Array(256);
for (let n = 0; n < table.length; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  table[n] = value >>> 0;
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
module.exports = { crc32 };
