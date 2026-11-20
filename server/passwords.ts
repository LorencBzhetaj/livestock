import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, options,
    (error, result) => error ? reject(error) : resolve(result)))
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  return 'scrypt-131072-8-1$' + salt.toString('base64url') + '$' + (await derive(password, salt)).toString('base64url')
}
export async function checkPassword(password: string, encoded?: string) {
  const parts = encoded?.split('$')
  const valid = parts?.length === 3 && parts[0] === 'scrypt-131072-8-1' &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[1]) && /^[A-Za-z0-9_-]{86}$/.test(parts[2])
  const actual = await derive(password, valid ? Buffer.from(parts[1], 'base64url') : Buffer.alloc(16))
  return Boolean(valid && timingSafeEqual(actual, Buffer.from(parts![2], 'base64url')))
}
