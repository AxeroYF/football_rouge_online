import crypto from 'node:crypto';

// S4 salts are binary base64url; current campaign salts are hexadecimal text.
export function accountPasswordMatches(password, account) {
  if (typeof password !== 'string' || !password.length || password.length > 4096) return false;
  try {
    let salt, expected;
    if (String(account.passwordHash).startsWith('scrypt$')) {
      const fields = account.passwordHash.split('$');
      if (fields.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(fields[1]) || !/^[A-Za-z0-9_-]+$/.test(fields[2])) return false;
      salt = Buffer.from(fields[1], 'base64url'); expected = Buffer.from(fields[2], 'base64url');
      if (salt.length !== 16 || expected.length !== 64) return false;
    } else {
      if (!/^[a-f0-9]{128}$/i.test(account.passwordHash ?? '') || !/^[a-f0-9]{32}$/i.test(account.passwordSalt ?? '')) return false;
      salt = account.passwordSalt; expected = Buffer.from(account.passwordHash, 'hex');
    }
    return crypto.timingSafeEqual(expected, crypto.scryptSync(password, salt, 64));
  } catch { return false; }
}
