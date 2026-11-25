# Production database recovery (Neon)

**Status: NOT VERIFIED.** This audit had no Neon access. Snapshot `snap-wild-rice-bacqz7uz`, the branch it belongs to, and the recovery window are all unconfirmed. Do not rely on the snapshot until the rehearsal below has passed.

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
