import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'
import { URL } from 'node:url'
import { writeFile, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Pool } from 'pg'
import { z } from 'zod'

async function main() {
  const connectionString = process.env.PUSH_DATABASE_URL
  const url = new URL(connectionString)
  if (url.protocol !== 'postgresql:' || url.searchParams.get('sslmode') !== 'verify-full') throw new Error()
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000, statement_timeout: 5000 })
  try {
    const action = process.argv[2]
    if (action === 'migrate') {
      await pool.query(await readFile(new URL('../server/push-schema.sql', import.meta.url), 'utf8'))
      return
    }
    if (action === 'purge') {
      await pool.query("DELETE FROM livestock_push_devices WHERE expires_at <= now()")
      await pool.query("DELETE FROM livestock_push_grants WHERE expires_at <= now()")
      await pool.query("DELETE FROM livestock_push_quota WHERE bucket < (extract(epoch from now()) / 60)::bigint - 1440")
      return
    }
    const principal = z.uuid().parse(process.env.PUSH_PRINCIPAL_ID)
    if (action === 'revoke') {
      const id = z.uuid().parse(process.env.PUSH_DEVICE_ID)
      await pool.query('DELETE FROM livestock_push_devices WHERE id=$1 AND principal_id=$2', [id, principal])
      return
    }
    if (action !== 'issue') throw new Error()
    const destination = process.env.PUSH_GRANT_FILE
    if (!destination || !isAbsolute(destination)) throw new Error()
    const code = randomBytes(32).toString('base64url')
    const digest = createHash('sha256').update(code).digest('hex')
    await pool.query("INSERT INTO livestock_push_grants (digest,principal_id,expires_at) VALUES ($1,$2,now()+interval '15 minutes')", [digest, principal])
    try { await writeFile(destination, code + '\n', { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      await pool.query('DELETE FROM livestock_push_grants WHERE digest=$1', [digest])
      throw error
    }
  } finally { await pool.end() }
}

try { await main(); console.info('Push administration operation completed.') }
catch { console.error('Push administration failed. Check the private configuration and database permissions.'); process.exitCode = 1 }
