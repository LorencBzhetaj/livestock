import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import console from 'node:console'
import { Client } from 'pg'
import { z } from 'zod'

async function bootstrap() {
  const url = new URL(process.env.SYNC_OPERATOR_DATABASE_URL)
  const farmName = z.string().trim().min(1).max(80).parse(process.argv[2])
  const file = process.argv[3]
  if (!file || !isAbsolute(file) || !file.endsWith('.sync-grant')) throw new Error('Invalid destination')
  if (url.protocol !== 'postgresql:' || url.hostname.includes('-pooler.') || url.searchParams.get('sslmode') !== 'verify-full'
    || url.username === 'livestock_sync_runtime') throw new Error('Invalid operator connection')
  const farm = randomUUID()
  const identity = randomUUID()
  const code = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(code).digest('hex')
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query('INSERT INTO livestock_sync.farms(id,name) VALUES ($1,$2)', [farm, farmName])
    await client.query('INSERT INTO livestock_sync.identities(id) VALUES ($1)', [identity])
    await client.query('INSERT INTO livestock_sync.farm_members(farm_id,identity_id) VALUES ($1,$2)', [farm, identity])
    await client.query("INSERT INTO livestock_sync.enrollment(code_digest,farm_id,identity_id,expires_at) VALUES ($1,$2,$3,now()+interval '15 minutes')", [digest, farm, identity])
    await writeFile(file, code + '\n', { flag: 'wx', mode: 0o600 })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}
try { await bootstrap(); console.info('Farm and initial enrollment grant created.') }
catch { console.error('Sync bootstrap failed. Check private configuration and the grant file before retrying.'); process.exitCode = 1 }
