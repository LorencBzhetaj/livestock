# Copy and paste into Codex

Build LivestockOS in this repository using the supplied planning pack. Read AGENTS.md and all files under docs/ first. The farm currently has ~200 GOATS, with other species supported by the data model but not necessarily exposed in Phase 1 UI. Single owner, Albanian UI first, English optional, usable on phone and desktop. Must be free and offline-first.

FIRST TASK ONLY: implement Milestone M0 and M1 from docs/ROADMAP.md: scaffold Vite + React + TypeScript, Tailwind, Dexie, Zod, Vitest, PWA shell, layout/navigation, Albanian strings, typed versioned database models, seed DEMO data behind explicit opt-in, and initial tests. Do not implement later milestones in this run. Do not connect to cloud, deploy, buy anything, or push to production.

Requirements: follow docs/ARCHITECTURE.md and docs/DATA_MODEL.md; add package scripts dev/build/test/lint; include README with setup commands. Run tests and build. If blocked, explain precisely instead of guessing. End with: files changed, commands executed, tests passed/failed, data safety concerns, and exact next milestone. Do not run infinite loops or make speculative rewrites.
