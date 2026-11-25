// Operation ids are canonical ULIDs the caller mints before it submits, so a
// caller always holds the id it needs to look up a lost submission.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A fresh canonical ULID for a recorded operation: 48 bits of the current
 * Unix time in milliseconds, then 80 random bits, as 26 Crockford base32
 * characters. The server refuses an id dated more than a minute ahead of its
 * clock, and one at or before its record's eviction mark.
 */
export function newOperationId(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48)
    throw new RangeError('operation id time must be a 48-bit millisecond timestamp');
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let random = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      random += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return time + random;
}
