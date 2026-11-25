# M8 Production release checklist

Work in this order. Every **APPROVAL** step needs your explicit "yes" for that step alone. Every other step is either done already or read-only. Stop at the first failure.

| # | Step | Status | Approval |
|---|---|---|---|
| 1 | Review and push branch `codex/production-readiness`, then open a PR to `main` | Ready | **APPROVAL A: push** |
| 2 | Merge the PR into `main`. Deploys stay off (`vercel.json`), and the Preview scheduler keeps working. | After review | **APPROVAL B: merge** |
| 3 | Export a device backup from the Admin phone and desktop (Settings → Backup) | You, on your devices | none |
| 4 | Read-only Neon check: project, Production branch, database name, M7B tables, snapshot `snap-wild-rice-bacqz7uz` and restore window ([RECOVERY.md](RECOVERY.md)) | BLOCKED: no access | **APPROVAL C: read-only Neon access** (or you run it and share the non-secret output) |
| 5 | Snapshot rehearsal on a *new* temporary branch, then `pg_dump` an independent copy | Not done | **APPROVAL D: temporary branch** |
| 6 | Confirm the SHA-256 of the migration: `git show HEAD:server/production-m8.sql \| sha256sum` = `74521082ca3b860c1bc4e2100351fb3b76423156faeef320e9bdff9f9ba4b3ec` | Ready | none |
| 7 | Run `server/production-m8.sql` with `psql -v ON_ERROR_STOP=1 -v expected_database=<name>`. It adds a schema, a NOLOGIN role and grants on the 4 existing M7B tables. | Prepared and tested | **APPROVAL E: migration and its grants** |
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
