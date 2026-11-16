# Product specification

## Users and goals
Single owner in Albania. Initially ~200 goats, later sheep/cattle/other animals. Quick field entry on phone, detailed review on desktop. Albanian primary; English optional. Free software, no required subscription.

## MVP functional requirements
- Dashboard: total active animals, overdue/upcoming user-defined tasks, recent events, offline status, backup age.
- Animal list: searchable by ear tag/name; filters sex/status/group; add/edit/archive; CSV import preview.
- Animal profile: UUID, ear tag, name optional, species, breed optional, sex, birth date approximate flag, origin, dam/sire optional, group, notes, status, photo optional later.
- Health timeline: date, event type (checkup, illness, vaccine, treatment, other), notes, vet optional, attachments deferred.
- Vaccination: product, batch optional, administration date, next due date optional, veterinarian optional, notes; no default vaccine schedule.
- Treatment: product, dose text, start/end, withdrawal dates optional, notes; never auto-prescribe.
- Tasks: title, due date, animal optional, status, completion timestamp; due/overdue computed locally.
- Batch action: record one vaccination event for multiple selected animals with individually persisted entries and shared batch ID; preview before commit.
- Export: CSV animal register and health events; JSON full backup with schema version and integrity checks; import restore with preview and explicit confirmation.
- Works offline after first successful installation, reload persists data; responsive on mobile and desktop.

## Later (not MVP)
Breeding/pregnancy/births, weight/milk, feed/medicine stock, finances, QR/RFID, vet accounts, push notifications, cross-device sync.

## Non-functional
200+ animals without pagination lag; no internet required for normal CRUD; no analytics/tracking; deterministic tests; accessible controls; no silent destructive migrations.
