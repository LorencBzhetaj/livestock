# Production database recovery (Neon)

## Verified on 25 Nov 2026 (read-only Neon CLI and `READ ONLY` transactions)
| Item | Finding |
|---|---|
| Project | `hidden-morning-02953673` (`my-first-project`), `aws-eu-central-1`, PostgreSQL 18.7 |
| Production branch | `production` (`br-bitter-leaf-ba88ggv0`), the default branch; database `neondb`; owner `neondb_owner` |
| Preview branch | `livestock-m8-preview` (`br-proud-wildflower-bac66v3v`). It is a separate root branch, not a child of Production. |
| Schema | `public` only. The 4 M7B tables match `server/push-schema.sql` and hold **0 rows**. No `livestock_sync` schema or runtime role exists yet. |
| Ownership | The M7B tables belong to `livestock_m7b_migrator`. `neondb_owner` holds ADMIN on it without INHERIT or SET, which is why the migration issues those grants as the table owner. |
| Snapshot | `snap-wild-rice-bacqz7uz` (`livestock-pre-m8-production`). It is taken from the production branch, manual, created 24 Nov at 22:47:49 UTC, 31,916,032 bytes (equal to the current branch size). It has **no expiry**. |
| Automatic snapshots | **None scheduled** for the production branch. |
| Point-in-time restore window | 21,600 s = **6 hours** |

**Rehearsal (D) passed.**
- The snapshot was restored, without finalizing, to the new branch `livestock-restore-rehearsal-20261125` (`br-nameless-scene-ba2mojdz`, endpoint `ep-shy-violet-baj9zg7s`).
- The production branch stayed the default branch and was not changed.
- The restored copy is identical to Production in schema, constraints, indexes, roles, memberships, ACLs, row counts and size.
- The migration was then applied **to the copy only**. It took 227 ms and created 21 tables and 35 indexes.
- The runtime role has exactly the intended rights: no UPDATE on `changes` or `health_events`, no CREATE in the schema.
- Memberships are unchanged apart from the automatic ADMIN that Postgres gives a role's creator.
- A second run is refused.

The rehearsal branch is kept for comparison until E is done.

## Verify the snapshot (read-only, before the migration)
1. In the Neon console, open the project behind `livestock-liart.vercel.app` and its Production branch. Note the project ID, branch ID and database name. Use that database name as `expected_database` and `SYNC_DATABASE_NAME`.
2. Under **Backup & Restore**, confirm that `snap-wild-rice-bacqz7uz` is listed **on that branch**, and note when it was taken. With the CLI: `neon snapshots list` (run `neon snapshots --help` for the flags in your CLI version).
3. Read the instant-restore (point-in-time) window for the plan in project settings. It is a second, independent recovery path.

## Rehearse a restore without touching Production
1. Use the **multi-step restore**: create a *new* branch from the snapshot. In the CLI and API the restore stays un-finalized by default, so you can inspect it first.
2. Connect to the new branch only. Compare the following with Production:
   - `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','livestock_sync') ORDER BY 1,2;`
   - row counts of the four `livestock_push_*` tables.
3. Delete the rehearsal branch afterwards. Never finalize the rehearsal onto the Production branch.

## Independent copy
Before the migration, take a logical dump with the owner role. Use a non-pooled connection with `sslmode=verify-full`:
`pg_dump --format=custom --no-owner --file=<private path>.dump "<owner connection>"`
Store the dump privately. It is sensitive and must never be committed to git.

## If something goes wrong after the migration
1. **First, switch the features off. No data change is needed.** Remove `LIVESTOCK_PRODUCTION=1`, or `SYNC_ENABLED` / `AUTH_ENABLED` / `REMINDERS_ENABLED`, and redeploy. Every M8 endpoint then returns 503 and the app keeps working offline from each device's IndexedDB. Pending device edits stay queued.
2. **Restoring the database is a last resort.** A **one-step restore** replaces the branch state with the snapshot. It keeps the branch name and connection string, changes the branch ID, and keeps the previous state as a backup branch named `<branch>_old_<timestamp>` (check the exact name on the Branches page). After that kind of restore, instant restore (PITR) is not available on the restored branch, and "reset from parent" is blocked for up to 24 hours. Anything synchronized after the snapshot is lost from the server, but it still exists on devices and in device backups.
3. Removing the `livestock_sync` schema or role is destructive. It needs its own written approval and is deliberately not scripted here.

## Device-level backups
Admin devices export backup format v1 (Settings → Backup). Restores are atomic and validated before any write. This is covered by `tests/backup*.test.ts` and `tests/e2e/backup.spec.ts`. Keep at least one fresh export before every release step.
