# Ordered Codex roadmap

M0 Repository foundation: Vite React TS, scripts, lint, test framework, routing, Tailwind, PWA install/offline shell, Albanian navigation. Verify build and offline shell.
M1 Data foundation: Dexie v1 schema, Zod schemas, UUID helper, repository CRUD, migrations tests, demo seed behind opt-in. Verify reload persistence.
M2 Animal registry: create/edit/archive, search/filter, 200-animal import preview/duplicate handling, responsive list and profile. Tests.
M3 Veterinary records: checkups, vaccines, treatments, timeline, batch vaccination with transaction safety. Tests.
M4 Tasks/dashboard: user-defined reminders, overdue/upcoming cards, local date handling. Tests.
M5 Backup/recovery: versioned JSON export, checksum/integrity, validation, preview, explicit restore mode (replace vs merge), CSV export/import, backup age warning. Test roundtrip and corrupt file rejection.
M6 Hardening: PWA offline tests on mobile/desktop, accessibility, performance 200+ records, documented backup drills, release candidate.
M7 Optional future: breeding/weight/milk, inventory, finance, then secure sync (separate design approval).

Gate after every milestone: tests pass, build passes, manual checklist recorded, user approves next milestone. No automatic production deployment.
