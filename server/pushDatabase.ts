import { Pool } from 'pg'
import type { Transaction } from './pushStore.js'

export function postgresTransactions(connectionString: string): Transaction {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000, statement_timeout: 5000 })
  // An idle connection failure must not crash a serverless instance.
  pool.on('error', () => undefined)
  return async (run) => {
    const client = await pool.connect()
    let broken = false
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { broken = true }
      throw error
    } finally {
      client.release(broken)
    }
  }
}
