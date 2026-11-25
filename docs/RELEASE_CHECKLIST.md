# M8 Production release checklist

Work in this order. Every **APPROVAL** step needs your explicit "yes" for that step alone. Every other step is either done already or read-only. Stop at the first failure.

| # | Step | Status | Approval |
|---|---|---|---|
| 1 | Review and push branch `codex/production-readiness`, then open a PR to `main` | Done (PR #1) | A ✔ |
| 2 | Merge the PR into `main`. Deploys stay off (`vercel.json`), and the Preview scheduler keeps working. | Done (`ee03474`) | B ✔ |
| 3 | Export a device backup from the Admin phone and desktop (Settings → Backup) | You, on your devices | none |
| 4 | Read-only Neon check: project, Production branch, database name, M7B tables, snapshot and restore window | **Done**, see [RECOVERY.md](RECOVERY.md). It found that the M7B tables are owned by `livestock_m7b_migrator`, and the migration was fixed for that. | C ✔ |
| 5 | Snapshot rehearsal on a *new* branch, plus the migration rehearsed on that copy | **Done**: the copy was identical and the migration applied in 227 ms. A `pg_dump` copy is still optional. | D ✔ |
| 6 | Confirm the SHA-256 of the migration: `git show HEAD:server/production-m8.sql | sha256sum` = `ce7dbaf3286975199b389a1cef10e52d4ec1ea8de3b26a2ea237c837f87084c2` | Ready | none |
| 7 | Apply it to `neondb` on endpoint `ep-rapid-silence-bak73d1d` (production), with psql, or without psql: `MIGRATION_DATABASE_URL=<owner, unpooled> node scripts/apply-production-m8.mjs --endpoint ep-rapid-silence-bak73d1d --database neondb --sha256 <above> --confirm apply-m8`. It adds a schema and a NOLOGIN role, and has the M7B owner grant access to the 4 existing tables. | **Done** on 25 Nov 2026 at 00:35:44 UTC. Verified identical to the rehearsal. | E ✔ |
| 8 | Set the runtime role password privately and enable LOGIN | Not done | **APPROVAL F: database permission change** |
| 9 | Bootstrap the farm (`scripts/sync-bootstrap.mjs`) and the owner setup code (`scripts/auth-setup.mjs` with `AUTH_SETUP_EXPECTED_DATABASE`) | Not done | part of F |
| 10 | Generate new Production keys and set the variables in [ENVIRONMENT.md](ENVIRONMENT.md). Keep `REMINDERS_ENABLED` off for now. | Not done | **APPROVAL G: Production environment variables** |
| 11 | Deploy `main` to Production manually (Vercel CLI or console promote). Check: `/api/sync` returns 405 to GET; sign in as `adi`; create the `vet` account; the Vet gets 403 on edits; offline reopen works; two devices sync. | Not done | **APPROVAL H: Production deploy** |
| 12 | Choose the scheduler ([SCHEDULER.md](SCHEDULER.md)), then set `REMINDERS_ENABLED=1` and `REMINDERS_SCHEDULER_READY=1`. Run one `dry-run`, then enroll one phone. | Not done | **APPROVAL I: scheduler service** and **APPROVAL J: enable delivery** |
| 13 | Physical checks on an iPhone (installed to the home screen, iOS 16.4+) and an Android phone: push delivery, notification tap, offline use | Needs devices | none |

## Rollback at any step
- Before step 11, nothing in Production has changed.
- After step 11, remove `LIVESTOCK_PRODUCTION` and redeploy. The M8 endpoints return 503 and the app keeps working offline.
- Restoring the database is a last resort ([RECOVERY.md](RECOVERY.md)).
