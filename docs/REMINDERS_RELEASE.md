# Authenticated reminders and main release
The new /api/reminders adapter runs only in the isolated M8 Preview. It uses the existing M8 session and farm identity, encrypted M7B subscription format, provider validation, durable request receipts, quotas and delivery implementation. There are no new paid dependencies.

An Admin explicitly enables this device from Settings. No enrollment code is needed. Device bindings reference the authenticated M8 device and existing M7B delivery device. Both are checked before dispatch; expired/revoked sessions, disabled accounts and revoked endpoints cannot reserve new deliveries. Revocation does not retract provider requests already in flight. Vet requests return HTTP 403. Failed provider requests retain a receipt to prevent ambiguous retries from sending twice.

## Scheduling and dates
One private daily digest covers pending tasks and explicitly recorded clinical next-due/follow-up dates. Clinical amendments resolve to the latest record. Linked tasks, including cancelled/completed reminders, suppress a second clinical reminder. No task or medical interval is invented. Task dates retain their saved owner-selected date. Archived animals do not create new clinical notices.

The scheduler uses the device-selected IANA timezone, preferred time and lead days. A nonexistent spring-forward time runs at the first scheduler invocation after that time; repeated autumn times reuse the same local-day receipt. Overdue work remains eligible for a daily summary until resolved. The generic push contains no animal names, diagnoses, counts or other farm data. Clicking a reminder opens the calendar; test notifications preserve an existing page.

Offline reminders remain in the dashboard and calendar. Offline notification preference edits are stored using the existing backup-compatible preference schema and submitted when Settings reconnects. Changes made offline cannot affect a background schedule before synchronization.

## Additive migration
Apply server/push-schema.sql only if all four M7B tables are absent in the isolated database; stop on partial schema. Then apply server/reminder-schema.sql. This adds livestock_sync.reminder_devices and minimum grants on isolated M7B tables. Neither Production database nor its M7B roles/tables are modified. No IndexedDB migration or backup version change is required.

Preview migration SHA-256: 677f547518e580e20ef6384b30f9cbd1b5f49fd90fa18e783d81d6566bf2c2d1.

## Activation
Preview-only server variables: REMINDERS_ENABLED, REMINDERS_CRON_KEY, PUSH_SERVER_KEY, PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT. The adapter reuses the isolated SYNC_DATABASE_URL and SYNC_ALLOWED_ORIGIN. Keys are retained privately under Windows DPAPI, outside Git. Never put private keys in VITE variables.

The GitHub Actions workflow uses cron `7,22,37,52 * * * *` (off the start of the hour; best-effort backup, see SCHEDULER.md), runs only from `main`, and supports manual dispatch with `dry_run=true` by default. It has no repository token permissions, a two-minute timeout and one shared non-overlapping concurrency group. Actual scheduled delivery is disabled until the repository variable REMINDERS_SCHEDULER_ENABLED is true. Set REMINDERS_URL to the fixed Preview /api/reminders endpoint. Actions secrets REMINDERS_CRON_KEY and VERCEL_AUTOMATION_BYPASS_SECRET belong to the main-only `m8-preview-notifications` GitHub Environment. Reuse existing authorized Preview automation access; do not create or weaken Production protection.

The server-only Preview variable REMINDERS_EXPECTED_HOST_HASH pins the canonical Neon endpoint hostname using SHA-256, with the pooler suffix removed. Derive it from the control-plane endpoint for the approved isolated branch. REMINDERS_TARGET_FINGERPRINT in Actions must match. The API fails closed before connecting if its configured database host differs. An authenticated dry-run uses header `x-livestock-dry-run: 1`, selects due records without reserving receipts, pruning records, updating quotas or contacting a provider, and returns only counters plus safe database/role/endpoint-fingerprint diagnostics. Verify these before enabling delivery. Tests of duplicate and concurrent runs use embedded PostgreSQL and a stub provider, never synthetic notifications to actual devices.

Scheduled Actions execute only from the repository default branch, now authorized as `main`; the Vercel Production branch remains separately pinned to M5. GitHub can delay scheduled runs, so cron recognition, manual completion and the first actual schedule-triggered success must be recorded separately.

Only after a scheduled run has actually succeeded, set REMINDERS_SCHEDULER_READY=1 in the M8 Preview branch environment and redeploy Preview. Until then, Settings accurately shows background activation pending. No device is enrolled automatically, and no real notification was sent by development tests.

GitHub scheduled runs can be delayed or dropped; the preferred time is not an exact alarm. Public-repository standard runners do not require a paid service. A controlled scheduler can invoke the same authenticated endpoint if stricter timing is needed. See [GitHub schedule semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Release safety and physical verification
The configured Vercel Production branch was codex/m5-backup-restore at inspection. Main auto-deployments are explicitly disabled in vercel.json. Recheck the project immediately before pushing main. Do not change Production variables or deploy Production.

iPhone installation, permission, foreground/background arrival, click, Android delivery and real-device reconnect tests: NOT TESTED. Automated tests use synthetic records and provider stubs. Provider acceptance is not proof of device arrival.
