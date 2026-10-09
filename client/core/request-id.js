let serverClockOffset=0;
export function setRequestClock(serverNow){if(Number.isFinite(serverNow))serverClockOffset=serverNow-Date.now();}
// getRandomValues remains available on plain HTTP, unlike randomUUID.
export function createRequestId(cryptoImpl = globalThis.crypto, now = Date.now()+serverClockOffset) {
  const stamp = Math.trunc(now).toString(16).padStart(12, '0');
  const timed = id => `${stamp.slice(0,8)}-${stamp.slice(8)}-7${id.slice(15)}`;
  if (typeof cryptoImpl?.randomUUID === 'function') return timed(cryptoImpl.randomUUID());
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return timed([hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'));
}
