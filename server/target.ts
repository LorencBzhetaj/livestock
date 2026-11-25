// One rule for every server endpoint: which database a deployment may use.
// Preview stays pinned to the isolated M8 database. Production needs an explicit
// opt-in, a declared database name, the least-privilege runtime role and verified TLS.
export const runtimeRole = 'livestock_sync_runtime'
export const previewDatabase = 'livestock_m8_preview'
const databaseName = /^[a-z_][a-z0-9_]{0,62}$/

export function runtimeDatabase(env: NodeJS.ProcessEnv) {
  let expected: string | undefined
  if (env.VERCEL_ENV === 'preview') expected = previewDatabase
  else if (env.VERCEL_ENV === 'production' && env.LIVESTOCK_PRODUCTION === '1' &&
    databaseName.test(env.SYNC_DATABASE_NAME ?? '') && env.SYNC_DATABASE_NAME !== previewDatabase) expected = env.SYNC_DATABASE_NAME
  if (!expected || !env.SYNC_DATABASE_URL) return
  try {
    const url = new URL(env.SYNC_DATABASE_URL)
    if (url.protocol !== 'postgresql:' || url.username !== runtimeRole || url.pathname !== '/' + expected ||
      url.searchParams.get('sslmode') !== 'verify-full') return
    return { url, database: expected, stage: env.VERCEL_ENV as 'preview' | 'production' }
  } catch { return }
}

export function allowedOrigin(env: NodeJS.ProcessEnv) {
  const value = env.SYNC_ALLOWED_ORIGIN
  if (!value || !URL.canParse(value)) return
  const url = new URL(value)
  return url.protocol === 'https:' && url.origin === value ? value : undefined
}
