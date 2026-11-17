import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'

export interface Sql {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>
}

export type Transaction = <T>(run: (sql: Sql) => Promise<T>) => Promise<T>
export type Outcome = 'serverAccepted' | 'providerAccepted' | 'providerRejected'

type Device = { id: string; principal_id: string; endpoint_hash: string; sealed_subscription: string }
type Grant = { principal_id: string; request_id: string | null; device_id: string | null; payload_hash: string | null }

export function createPushStore(transaction: Transaction, clock?: () => number) {
  async function limited(sql: Sql, scope: string, bucket: number, maximum: number) {
    const result = await sql.query<{ attempts: number }>(
      `INSERT INTO livestock_push_quota (scope,bucket,attempts) VALUES ($1,$2,1)
       ON CONFLICT (scope,bucket) DO UPDATE SET attempts=livestock_push_quota.attempts+1
       WHERE livestock_push_quota.attempts < $3 RETURNING attempts`, [scope, bucket, maximum],
    )
    return result.rows.length === 0
  }

  async function databaseTime(sql: Sql) {
    if (clock) return clock()
    const result = await sql.query<{ now_ms: string }>('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms')
    return Number(result.rows[0].now_ms)
  }

  async function active(sql: Sql, id: string | undefined, time: string) {
    if (!id) return
    return (await sql.query<Device>('SELECT * FROM livestock_push_devices WHERE id=$1 AND expires_at>$2', [id, time])).rows[0]
  }

  return {
    status: (id?: string) => transaction(async (sql) => {
      // Verify the provisioned schema even when no device cookie is present.
      await sql.query('SELECT digest FROM livestock_push_grants LIMIT 0')
      await sql.query('SELECT scope FROM livestock_push_quota LIMIT 0')
      await sql.query('SELECT request_id FROM livestock_push_receipts LIMIT 0')
      await sql.query('SELECT id FROM livestock_push_devices LIMIT 0')
      const device = await active(sql, id, new Date(await databaseTime(sql)).toISOString())
      if (!device) return { enrolled: false }
      const previous = await sql.query<{ outcome: Outcome }>(
        'SELECT outcome FROM livestock_push_receipts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1', [device.id],
      )
      return { enrolled: true, lastTest: previous.rows[0]?.outcome }
    }),
    operate: (input: Operation) => transaction(async (sql): Promise<Decision> => {
      // A single short transaction lock orders endpoint ownership, revocation and receipt reservation across replicas.
      await sql.query('SELECT pg_advisory_xact_lock(17320107)')
      const now = await databaseTime(sql)
      const minute = Math.floor(now / 60_000)
      if (await limited(sql, 'attempts', minute, 60)) return { kind: 'limited' }
      const time = new Date(now).toISOString()
      await sql.query('DELETE FROM livestock_push_devices WHERE expires_at <= $1', [time])
      await sql.query('DELETE FROM livestock_push_grants WHERE expires_at <= $1', [time])
      await sql.query('DELETE FROM livestock_push_quota WHERE bucket < $1', [minute - 1440])
      // Old receipt IDs remain attached to their device until revocation/expiry to prevent replay.
      if (input.kind === 'invalid') return { kind: 'rejected' }
      const device = await active(sql, input.deviceId, time)
      if (input.kind === 'enroll') {
        const grant = (await sql.query<Grant>('SELECT * FROM livestock_push_grants WHERE digest=$1 AND expires_at>$2', [input.grant, time])).rows[0]
        if (!grant) return { kind: 'unauthorized' }
        if (grant.request_id) {
          const enrolled = await active(sql, grant.device_id ?? undefined, time)
          return grant.request_id === input.requestId && grant.payload_hash === input.payloadHash && enrolled &&
            (!device || device.id === enrolled.id)
            ? { kind: 'enrolled', id: enrolled.id } : { kind: 'conflict' }
        }
        if (device || input.expires <= now) return { kind: 'conflict' }
        if (await limited(sql, 'enroll:' + grant.principal_id, Math.floor(minute / 60) * 60, 3)) return { kind: 'limited' }
        const id = randomUUID()
        const inserted = await sql.query(
          `INSERT INTO livestock_push_devices (id,principal_id,endpoint_hash,sealed_subscription,expires_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (endpoint_hash) DO NOTHING RETURNING id`,
          [id, grant.principal_id, input.endpointHash, input.seal(id), new Date(input.expires).toISOString()],
        )
        if (!inserted.rows.length) return { kind: 'conflict' }
        await sql.query('UPDATE livestock_push_grants SET request_id=$2,device_id=$3,payload_hash=$4 WHERE digest=$1',
          [input.grant, input.requestId, id, input.payloadHash])
        return { kind: 'enrolled', id }
      }
      if (!input.deviceId) return { kind: 'unauthorized' }
      if (input.kind === 'revoke') {
        if (await limited(sql, 'revoke:' + (device?.principal_id ?? input.deviceId), Math.floor(minute / 60) * 60, 10)) {
          return { kind: 'limited' }
        }
        await sql.query('DELETE FROM livestock_push_devices WHERE id=$1', [input.deviceId])
        return { kind: 'revoked' }
      }
      if (!device) return { kind: 'expired' }
      if (input.endpointHash !== device.endpoint_hash) return { kind: 'conflict' }
      const receipt = (await sql.query<{ language: string; outcome: Outcome }>(
        'SELECT language,outcome FROM livestock_push_receipts WHERE device_id=$1 AND request_id=$2', [device.id, input.requestId],
      )).rows[0]
      if (receipt) return receipt.language === input.language ? { kind: receipt.outcome } : { kind: 'conflict' }
      if (await limited(sql, 'send-minute:' + device.principal_id, minute, 1) ||
          await limited(sql, 'send-day:' + device.principal_id, Math.floor(minute / 1440) * 1440, 5)) return { kind: 'limited' }
      await sql.query(
        `INSERT INTO livestock_push_receipts (device_id,request_id,language,outcome,created_at)
         VALUES ($1,$2,$3,'serverAccepted',$4)`, [device.id, input.requestId, input.language, time],
      )
      return { kind: 'send', device }
    }),
    complete: (deviceId: string, requestId: string, outcome: Outcome | 'expired') => transaction(async (sql) => {
      if (outcome === 'expired') await sql.query('DELETE FROM livestock_push_devices WHERE id=$1', [deviceId])
      else await sql.query('UPDATE livestock_push_receipts SET outcome=$3 WHERE device_id=$1 AND request_id=$2',
        [deviceId, requestId, outcome])
    }),
  }
}

export type PushStore = ReturnType<typeof createPushStore>

type Operation =
  | { kind: 'invalid' }
  | { kind: 'revoke'; deviceId?: string }
  | { kind: 'test'; deviceId?: string; requestId: string; language: 'sq' | 'en'; endpointHash: string }
  | { kind: 'enroll'; deviceId?: string; grant: string; requestId: string; payloadHash: string;
      endpointHash: string; expires: number; seal(id: string): string }

type Decision =
  | { kind: Outcome | 'limited' | 'unauthorized' | 'rejected' | 'conflict' | 'revoked' | 'expired' }
  | { kind: 'enrolled'; id: string }
  | { kind: 'send'; device: Device }
