# Reminder scheduler: diagnosis and architecture

## Why GitHub ran about 5 of 160 expected runs
Evidence comes from the public GitHub API, read on 24 Nov 2026 at 23:58 UTC.

- **The workflow is active.** It is "active" (id 425918908). It was created 21 Nov at 11:39 UTC and updated 22 Nov at 22:58 UTC.
- **Only 12 runs exist in total.** That count includes 5 runs whose job was **skipped**: they ran before `REMINDERS_SCHEDULER_ENABLED` was set. GitHub records a run *before* it evaluates the job's `if:`. So the job condition did not hide any runs; the missing schedule events were never created.
- **No runs were cancelled.** Each run takes about 11 s and the concurrency group has `cancel-in-progress: false`, so concurrency did not discard anything.
- **Permissions cannot suppress triggers.** `permissions: {}` only limits the job token.
- **Run times were scattered.** Runs started at 00:19, 07:59, 20:04, 04:48 and 15:33 UTC, with gaps of 7–12 hours. There has been no run in the 8.4 hours since the last one.

**Cause: GitHub's best-effort scheduler.** GitHub documents that the `schedule` event "can be delayed during periods of high loads" and that queued jobs "may be dropped". The worst load is at the start of every hour, and GitHub recommends a different minute. Public repositories also have scheduled workflows disabled after 60 days without repository activity. This is not a configuration bug, and no workflow change can make GitHub reliable.

## Safety of several triggers
`run()` is idempotent per device and local date:
- the digest ID is `summaryId(device, localDate)`;
- the receipt is reserved under `pg_advisory_xact_lock`;
- a second trigger replays the stored receipt instead of sending again.

This is covered by `tests/reminders.test.ts`, including concurrent runs. So any number of independent triggers can safely call the endpoint. A missed day is a delay, not data loss: pending and overdue tasks appear again in the next day's digest.

## Changes made on this branch
- **Vercel Cron support.** `GET /api/reminders` with `Authorization: Bearer <REMINDERS_CRON_KEY>` performs a real run, because Vercel Cron sends GET. A missing or wrong key still returns 401.
- **All Admin devices in one run.** Scheduled digests no longer use the per-person test-send limits (1 per minute, 5 per day). Previously each additional Admin device waited for the *next* trigger, which could mean hours with GitHub.
- **Off-hour GitHub cron.** The cron is now `7,22,37,52 * * * *`, away from the start of the hour. It is kept only as a backup.

## Recommended architecture for Production
| Layer | Trigger | Reliability | Cost and setup |
|---|---|---|---|
| Primary | An HTTP cron service calling `POST https://livestock-liart.vercel.app/api/reminders` every 15 min with the bearer header and `x-livestock-dry-run: 0` (for example cron-job.org). Alternatively Vercel Cron `*/15` on the Pro plan. | Minute-level | External account (the third party holds the cron key), or a paid Vercel plan |
| Safety net | Vercel Cron, once a day, on Production: `{"crons":[{"path":"/api/reminders","schedule":"30 17 * * *"}]}`. Set `CRON_SECRET` to the same value as `REMINDERS_CRON_KEY`. | Daily; on Hobby the run can fire at any minute of that hour | Free on Hobby (limited to once a day) |
| Backup | The existing GitHub workflow, with a Production job added later | Best effort | Free |

## Decision (25 Nov 2026): free daily Vercel Cron
The owner chose the free option. Reminders are counted in days (before a vaccination or task date), so one run each morning is enough.

- **Trigger:** Vercel Cron on Production, `0 7 * * *` (07:00 UTC), set in `vercel.json`. On the Hobby plan it fires at some minute within that hour, which is 08:00–08:59 in Tirana in winter and 09:00–09:59 in summer. `CRON_SECRET` holds the same value as `REMINDERS_CRON_KEY`, so the GET carries the right bearer key.
- **Reminder time:** the Settings form limits the time to 08:00 or earlier, because a later time would never be reached by a morning run.
- **Which days:** a reminder 7, 3 and 1 day before a date, and on the day (`reminderDays` in `server/reminderSchedule.ts`; the lead defaults to 7, and a larger lead adds one earlier reminder). A pending task that is past its date repeats every day until it is done or cancelled. A recorded next-vaccination date without a task is announced only on those days.
- **GitHub:** the workflow stays pointed at Preview. No external cron account and no cost.
- **If a run is missed:** the next day's run still sends whatever is due that day. Each device gets at most one digest per local day.
