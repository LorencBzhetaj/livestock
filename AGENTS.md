# Instructions for Codex

You are implementing LivestockOS. Read docs before coding. Primary language Albanian; secondary English. Initial animal type goats, but never hardcode goat-only DB schema. ~200 animals, one owner, phone and desktop.

## Guardrails
- No paid dependencies, cloud services, domain purchases, deployments or GitHub pushes without explicit approval.
- Work offline-first. IndexedDB via Dexie is the Phase 1 source of truth; no fake cross-device synchronization.
- No credentials in code. Never fabricate medical advice, vaccination intervals, doses or withdrawal periods; user/vet enters them.
- Data integrity over visual polish. Stable UUID IDs, ISO timestamps, explicit timezone display, immutable event history where possible, soft archive for animals.
- Every mutation must be validated with Zod and covered by tests. Migrations must preserve data.
- Keep scope bounded. Before each task state plan, implement, run targeted tests/build, summarize changed files, blockers and next task. Avoid retry loops (max two attempts per failing command, then report).
- No deleting user data, clearing databases, resetting git, or overwriting backups without explicit confirmation.
- Accessibility: keyboard navigation, labels, responsive layout; PWA usable offline after initial install.
- Follow security guidelines: no sensitive details in logs, sanitize exports, validate imports, prevent CSV formula injection.
- Phase 1 no remote auth or cloud DB. Treat future sync as a separate approved milestone.
