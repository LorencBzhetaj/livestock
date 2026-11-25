# LivestockOS production audit — 25 November 2026

Branch `codex/production-readiness`, based on `main` at `1982897`. Labels: **VERIFIED** (checked directly in this audit), **FIXED** (changed and covered by a test), **NOT VERIFIED** (no access or needs a physical device), **BLOCKED** (cannot proceed without something missing or without approval).

## 1. Overall readiness

**Production M8 (accounts, sync, reminders) is not ready to release.** The application code is in good shape and the local-only PWA works well on phone and desktop. A Production M8 release is blocked by four things:

1. The reviewed migration file and release document named in the brief do not exist in the repository.
2. No Neon or Vercel access was available, so the database could not be inspected.
3. Every server endpoint is coded to refuse Production.
4. The GitHub cron scheduler does not run often enough for dependable daily reminders.

## 2. Findings by severity

### Critical
| # | Finding | Status |
|---|---|---|
| C1 | `server/production-m8-reviewed.sql` and `docs/PRODUCTION_RELEASE.md` are absent from every branch and all 13 commits of the public repository. The expected SHA-256 `c66941a3…54e4` cannot be checked against anything. The remote also had no `codex/production-readiness` branch; this audit created it. | BLOCKED |
| C2 | Neon project, branch, schema, snapshot `snap-wild-rice-bacqz7uz`, recovery window and grants were not inspected. No credentials or Neon tooling were available. The reported state (M7B present, M8 missing) is unconfirmed. | BLOCKED |

### High
| # | Finding | Status |
|---|---|---|
| H1 | Every endpoint started only on `VERCEL_ENV==="preview"`, and reminders were pinned to `/livestock_m8_preview`. **Update:** one shared check, `server/target.ts`, now governs all endpoints. Preview stays pinned to its database. Production requires `LIVESTOCK_PRODUCTION=1`, a declared `SYNC_DATABASE_NAME` matching the URL, the runtime role and `verify-full`. It is inert until the variables are approved. Test: `tests/target.test.ts`. | FIXED (inert) |
| H2 | The live Production deployment (`livestock-liart.vercel.app`) is a pre-M8 build. `GET /api/push` returns `{"publicKey":null,"testEnabled":false}`, and `/api/sync`, `/api/auth` and `/api/reminders` return 404. `vercel.json` disables Git deployments for `main`, so a release needs a manual, approved deploy. | VERIFIED |
| H3 | The scheduler was unreliable: 5 scheduled runs in about 40 hours. **Diagnosis:** the cause is GitHub's best-effort scheduler. Only 12 runs exist in total, skipped runs included, and none were cancelled. **Update:** the cron moved off the start of the hour; Vercel Cron (GET) is now supported; an architecture is proposed in [SCHEDULER.md](SCHEDULER.md). A dependable trigger still needs your choice. | BLOCKED on decision |
| H4 | The workflow is pinned to the Preview origin and its environment (correct isolation). There is no Production trigger yet; see SCHEDULER.md. | VERIFIED |

### Medium
| # | Finding | Status |
|---|---|---|
| M1 | Login lockout denial of service. The username `adi` is public, and 5 requests per 15 minutes from anywhere locked out the owner. 60 requests from anywhere blocked all logins. The limits are now 5 per username+address, 50 per username, 20 per address and 300 globally. scrypt (N=2^17) keeps the wider limits safe. Regression test: `tests/auth.test.ts` (fails on the old code, passes now). | FIXED |
| M2 | Phones had no route to the Tasks list or Reports. These were desktop-only sidebar items, Settings did not link them, and the Vet has no Settings. A scrollable row of 44 px shortcuts now appears under the header on phones. Test: `tests/e2e/responsive.spec.ts`. | FIXED |
| M3 | Phones in landscape (844×390) showed the desktop sidebar with only about 3 of 9 items visible in a tiny scroll area. Short landscape screens now use the bottom navigation. Test: `responsive.spec.ts`. | FIXED |
| M4 | Each extra Admin device waited for the next trigger. Scheduled digests now skip the per-person test-send limits; the daily digest receipt still dedupes. Test: `tests/reminders.test.ts`. | FIXED |

### Low
| # | Finding | Status |
|---|---|---|
| L1 | The Veterinaria/Vaksinimet view links were 21 px tall and are now 44 px. | FIXED |
| L2 | `api/push.ts` built an account store without role or `sslmode` checks. It now uses `server/target.ts`. | FIXED |
| L3 | Pending tasks of archived animals still count toward the daily digest (`server/reminderSchedule.ts`). | VERIFIED, not changed |
| L4 | `npm audit` shows 4 moderate advisories (minimatch/glob through `vite-plugin-pwa` → `workbox-build`). They are build-time only. The production dependency audit is clean. The only fix offered is a breaking downgrade. | VERIFIED |
| L5 | The CSS is desktop-first with `max-width` overrides layered over two style generations. It renders correctly, so no rewrite was made. | VERIFIED |

## 3. Database migration review
**Update (25 Nov):** a complete additive migration is now in [server/production-m8.sql](../server/production-m8.sql) (SHA-256 `74521082ca3b860c1bc4e2100351fb3b76423156faeef320e9bdff9f9ba4b3ec`, computed on the LF file in git). It adds:
- checks that stop on the wrong database, a partial schema, an existing role or missing M7B tables;
- `lock_timeout` 5 s and `statement_timeout` 60 s;
- one transaction with a history row.

`tests/production-migration.test.ts` checks that it yields exactly the Preview columns, constraints, indexes, role attributes and grants, refuses a second run and leaves M7B rows untouched. The originally referenced file `production-m8-reviewed.sql` was never found. The release order is in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Original review of the existing files:

**BLOCKED.** The file under review does not exist. What the existing SQL files show:

- Each file is wrapped in a transaction.
- They contain no DROP or TRUNCATE. The only destructive statement is `account-usernames.sql`, which overwrites account usernames.
- The runtime role is `NOLOGIN NOINHERIT NOBYPASSRLS` with column-level grants.
- They have no `lock_timeout` or `statement_timeout`, no migration-history table, and are not idempotent: `CREATE SCHEMA` and `CREATE ROLE` fail if they already exist.
- `push-schema.sql` uses `IF NOT EXISTS`. `reminder-schema.sql` grants the runtime role access to the existing M7B `public.livestock_push_*` tables.

A reviewed Production migration should add timeouts, a history row, and pre-checks that stop on a partial schema.

## 4. Backup and recovery
- **VERIFIED by tests:** backup format v1 and IndexedDB v5, checksum, photos, preview without writes, atomic restore with rollback, and size limit (`tests/backup*.test.ts`, `tests/e2e/backup.spec.ts`). The 1 skipped unit test is the opt-in stress test (`LIVESTOCK_BACKUP_STRESS=1`).
- **NOT VERIFIED:** Neon snapshot restore. A safe rehearsal restores the snapshot to a *new* Neon branch, compares row counts and schema, then deletes that branch. Never restore onto the Production branch.

## 5. Authentication
**VERIFIED** in code and tests:
- scrypt hashing with a constant-time comparison and a dummy derive for unknown users.
- `__Host-` cookies with `HttpOnly; Secure; SameSite=Strict`, lasting 12 hours or 30 days.
- Logout revokes the server session.
- Exact `Origin` and `Sec-Fetch-Site` checks on every POST.
- A Vet receives HTTP 403 from the server on sync mutations (tested over real HTTP), and the reminder API returns 403 to a Vet.
- Dexie middleware blocks a Vet's offline writes.
- Account-scoped IndexedDB names.

No passwords were reset or printed.

## 6. Synchronization
**VERIFIED by existing tests:**
- Transactional outbox.
- Server receipts acting as idempotency keys.
- Strict pull-cursor sequencing.
- Stale and constraint conflicts with resolution.
- Row-locked version allocation.
- Read-only Vet pull.
- Pending Admin edits survive logout (logout never clears IndexedDB).

**NOT VERIFIED:** behaviour on real devices with real networks.

## 7. Notifications
- **Scheduler execution:** VERIFIED as sparse (H3).
- **Provider acceptance:** NOT VERIFIED, because the Preview is behind Vercel Authentication.
- **Device delivery:** NOT VERIFIED, needs a physical device.
- **VERIFIED in code:**
  - Daily digest ID per device and local date.
  - Advisory lock and receipt reservation.
  - Re-checking revocation before sending.
  - 404/410 removes the subscription.
  - Expired rows are cleaned up.
  - Time-zone-aware time and lead days.
  - `sq` and `en` payloads.
- No notifications were sent during this audit.

## 8. UI and responsive quality
Checked at 390×844, 768×1024, 844×390 and 1366×800 on all 12 routes. No horizontal overflow was found. Fixes: M2, M3, L1. The visual direction (cream, forest sidebar, olive) is unchanged.

## 9. Test results
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: 60 passed, 1 skipped (the opt-in stress test).
- `npx playwright test`: 30 passed, 6 skipped (tests limited to the phone or the desktop project).
- `npm audit --omit=dev`: 0 vulnerabilities.
- Secret scan of all commits: clean.
- `git diff --check`: clean.

All checks were run locally on Windows with Chromium (desktop, and phone emulation at 390 px). **No physical iPhone or Android test was run.**

## 10. Approvals required (nothing below has been done)
Superseded by the ordered list in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
1. **Provide** `server/production-m8-reviewed.sql` and `docs/PRODUCTION_RELEASE.md`, or approve writing a new reviewed migration.
2. **Read-only Neon access** to confirm the project, branch, schema and snapshot.
3. **Snapshot restore rehearsal** onto a new temporary Neon branch.
4. **Code change** to allow `VERCEL_ENV=production` behind an explicit `LIVESTOCK_PRODUCTION=1` flag, with a Production database name check in place of `/livestock_m8_preview`.
5. **Production migration** run with `SET lock_timeout='5s'; SET statement_timeout='60s'`.
6. **Production environment variables:** `SYNC_DATABASE_URL` (runtime role, `sslmode=verify-full`), `SYNC_ALLOWED_ORIGIN`, `AUTH_ENABLED`, `SYNC_ENABLED`, `VITE_AUTH_REQUIRED`, and the reminder and VAPID keys. These must be new values, never Preview's.
7. **Scheduler:** choose a dependable trigger (for example Vercel Cron, an external cron service, or an hourly-tolerant design) before enabling Production delivery.
8. **Production deploy** of the merged commit.
