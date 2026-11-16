# Architecture decisions

Phase 1: Vite + React + TypeScript + Tailwind + React Router; Dexie over IndexedDB; Zod validation; Vitest + Testing Library + Playwright smoke tests; vite-plugin-pwa/Workbox.

Browser-local database on each device is independent. Installing the PWA on phone and desktop DOES NOT automatically share records. To move records in Phase 1 use explicit encrypted backup transfer (encryption only if properly implemented/tested; otherwise clearly mark backups as unencrypted and keep them private). Never promise automatic sync until Phase 4.

Offline caching: cache application shell/static assets; never cache sensitive API responses (none in MVP). Use an explicit offline indicator. Warn that iOS/browser storage may be evicted and backup is required. Persistent storage request when supported, not guaranteed.

Future sync: authenticated server, PostgreSQL, per-device change journal, idempotency keys, server revisions, conflict review; append-only medical events; tombstones/soft-delete; TLS, access controls, backups. Free tier is optional and not guaranteed. Design stable UUIDs and updatedAt now, but don't build sync in MVP.

Folders: src/app, src/components, src/features/animals, src/features/health, src/features/tasks, src/db, src/lib, src/i18n, src/styles, tests, public. Avoid giant components. Keep domain models separated from storage.
