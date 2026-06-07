// Pure-JS base64 <-> Uint8Array helpers.
//
// expo-file-system (SDK 52, legacy API) reads/writes binary as base64 strings,
// so we need to bridge to the Uint8Array that @gltf-transform expects. We avoid
// relying on global atob/btoa (not guaranteed across all RN/Hermes builds) and
// implement the codec directly so wireframe + dimension extraction work on-device.

const CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
  return table;
})();

export function base64ToBytes(base64: string): Uint8Array {
  // Strip whitespace and padding for length math.
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const byteLen = Math.floor((len * 3) / 4);
  const bytes = new Uint8Array(byteLen);

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const e0 = LOOKUP[clean.charCodeAt(i)];
    const e1 = LOOKUP[clean.charCodeAt(i + 1)];
    const e2 = LOOKUP[clean.charCodeAt(i + 2)];
    const e3 = LOOKUP[clean.charCodeAt(i + 3)];

    const chunk =
      (e0 << 18) |
      (e1 << 12) |
      ((e2 < 0 ? 0 : e2) << 6) |
      (e3 < 0 ? 0 : e3);

    if (outIdx < byteLen) bytes[outIdx++] = (chunk >> 16) & 0xff;
    if (e2 >= 0 && outIdx < byteLen) bytes[outIdx++] = (chunk >> 8) & 0xff;
    if (e3 >= 0 && outIdx < byteLen) bytes[outIdx++] = chunk & 0xff;
  }

  return outIdx === byteLen ? bytes : bytes.subarray(0, outIdx);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;

    result += CHARS[(triplet >> 18) & 0x3f];
    result += CHARS[(triplet >> 12) & 0x3f];
    result += i + 1 < len ? CHARS[(triplet >> 6) & 0x3f] : '=';
    result += i + 2 < len ? CHARS[triplet & 0x3f] : '=';
  }

  return result;
}
