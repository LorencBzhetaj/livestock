# Environment variables (names only — never commit values)

"Key" means 32 random bytes encoded as 43-character base64url (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Production must use **new** values. Never copy a Preview value, a Preview database URL or a Preview subscription.

## Vercel Production (M8)
| Name | Required value / rule | Read by |
|---|---|---|
| `VERCEL_ENV` | `production`. Set by Vercel. | all APIs |
| `LIVESTOCK_PRODUCTION` | `1`. New explicit opt-in; without it every M8 endpoint stays off. | `server/target.ts` |
| `SYNC_DATABASE_NAME` | The Production database name. It must match the URL path and must not be `livestock_m8_preview`. | `server/target.ts` |
| `SYNC_DATABASE_URL` | `postgresql://livestock_sync_runtime:…@<host>/<SYNC_DATABASE_NAME>?sslmode=verify-full`. A pooled host is allowed. | auth, sync, reminders, push |
| `SYNC_ALLOWED_ORIGIN` | `https://livestock-liart.vercel.app` (exact origin, no trailing slash) | auth, sync, reminders |
| `AUTH_ENABLED` | `1` | auth, sync, reminders, push |
| `SYNC_ENABLED` | `1` | sync |
| `VITE_AUTH_REQUIRED` | `1`. **Build-time and public.** It is baked into the client bundle, so it needs a rebuild. | client |
| `REMINDERS_ENABLED` | `1`. Only after the scheduler decision. | reminders |
| `REMINDERS_EXPECTED_HOST_HASH` | SHA-256 hex of the database hostname with `-pooler.` replaced by `.` | reminders |
| `REMINDERS_CRON_KEY` | Key | reminders, scheduler |
| `REMINDERS_SCHEDULER_READY` | `1` once a dependable trigger exists. It only tells the Settings page that background reminders are active. | reminders |
| `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` | A new VAPID key pair for Production | reminders |
| `PUSH_VAPID_SUBJECT` | `mailto:` address or `https://` URL | reminders |
| `PUSH_SERVER_KEY` | Key. It encrypts stored subscriptions; changing it later makes enrolled devices unreadable. | reminders |
| `CRON_SECRET` | Only for Vercel Cron: the same value as `REMINDERS_CRON_KEY` | Vercel Cron |

Must **not** be set in Production: `PUSH_DURABLE_TEST`, `PUSH_DATABASE_URL`, `PUSH_ALLOWED_ORIGIN`, `PUSH_LOCAL_TEST`, `PUSH_TEST_TOKEN`, `PUSH_TEST_SUBSCRIPTION`. These are M7B and local test switches; `api/push.ts` ignores the durable test in Production anyway.

## Vercel Preview (current M8 Preview)
The same names as Production, **except** `LIVESTOCK_PRODUCTION` and `SYNC_DATABASE_NAME`: Preview is always pinned to `livestock_m8_preview`. The M7B test endpoint can also use `PUSH_DURABLE_TEST`, `PUSH_DATABASE_URL` and `PUSH_ALLOWED_ORIGIN`.

## GitHub Actions (`.github/workflows/reminders.yml`)
| Name | Kind | Where |
|---|---|---|
| `REMINDERS_SCHEDULER_ENABLED` | variable (`true`) | repository variables |
| `REMINDERS_URL` | variable, fixed to the Preview `/api/reminders` | environment `m8-preview-notifications` |
| `REMINDERS_TARGET_FINGERPRINT` | variable, the same hash as `REMINDERS_EXPECTED_HOST_HASH` | same environment |
| `REMINDERS_CRON_KEY` | secret | same environment |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret, Preview protection only | same environment |

A Production job would need its own environment with a Production URL and key. That is not created yet; see [SCHEDULER.md](SCHEDULER.md).

## Operator workstation only (never on Vercel)
| Name | Purpose |
|---|---|
| `SYNC_OPERATOR_DATABASE_URL` | Owner role, **unpooled**, `sslmode=verify-full`. Used by `scripts/sync-bootstrap.mjs` and `scripts/auth-setup.mjs`. |
| `AUTH_SETUP_FARM_ID`, `AUTH_SETUP_EXPECTED_HOST` | Target farm and host for the owner setup code |
| `AUTH_SETUP_EXPECTED_DATABASE` | New. Set it to the Production database name; the default stays `livestock_m8_preview`. |
| `PUSH_DATABASE_URL`, `PUSH_GRANT_FILE`, `PUSH_PRINCIPAL_ID`, `PUSH_DEVICE_ID` | M7B `scripts/push-admin.mjs` only |
