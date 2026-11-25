// Applies server/production-m8.sql exactly as `psql -v expected_database=<db> -f` would, for machines without psql.
// Every guard must match or nothing is sent:
//   MIGRATION_DATABASE_URL  owner connection (unpooled), read from the environment, never printed
//   --endpoint ep-...       the Neon endpoint id the URL must point to
//   --database <name>       the expected database (also checked inside the migration)
//   --sha256 <hex>          the reviewed checksum of server/production-m8.sql (LF, as stored in git)
//   --confirm apply-m8      explicit confirmation
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import console from 'node:console'
import { URL } from 'node:url'
import { Client } from 'pg'

const option = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
async function main() {
  const endpoint = option('endpoint'), database = option('database'), expectedSha = option('sha256')
  if (option('confirm') !== 'apply-m8') throw Error('Pass --confirm apply-m8')
  if (!/^ep-[a-z0-9-]+$/.test(endpoint ?? '') || !/^[a-z_][a-z0-9_]{0,62}$/.test(database ?? '') || !/^[a-f0-9]{64}$/.test(expectedSha ?? '')) throw Error('Invalid --endpoint, --database or --sha256')
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '')
  if (url.protocol !== 'postgresql:' || url.hostname.includes('-pooler.') || !url.hostname.startsWith(endpoint + '.') ||
    url.pathname !== '/' + database || url.username === 'livestock_sync_runtime') throw Error('Connection does not match --endpoint/--database, is pooled, or uses the runtime role')
  const text = (await readFile(new URL('../server/production-m8.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const actual = createHash('sha256').update(text).digest('hex')
  if (actual !== expectedSha) throw Error('Checksum mismatch: file is ' + actual)
  const sql = text.split('\n').filter((line) => !line.trimStart().startsWith('\\')).join('\n').replace(":'expected_database'", "'" + database + "'")
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 15000 })
  await client.connect()
  try {
    await client.query(sql)
    const row = (await client.query('SELECT version, applied_by, applied_at FROM livestock_sync.migrations')).rows[0]
    console.info('Applied', row.version, 'as', row.applied_by, 'at', new Date(row.applied_at).toISOString())
  } finally { await client.end() }
}
try { await main() } catch (error) {
  console.error('Migration not applied:', String(error.message).replace(/postgres(ql)?:\/\/\S+/g, '<redacted>').split('\n')[0])
  process.exitCode = 1
}
