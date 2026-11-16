# Data model

## Version 1

Use UUID strings for primary keys, ISO UTC timestamps for createdAt/updatedAt. UI displays local timezone. Validate via Zod. IndexedDB indexes for earTag, speciesId, animalId, eventDate, dueDate, status.

species: id, code (goat/sheep/cattle/other), displayNameSq, displayNameEn, active.
animals: id, earTag (unique among active animals; case/whitespace normalized), name?, speciesId, breed?, sex (female/male/unknown), birthDate?, birthDateApproximate?, acquisitionDate?, source?, damId?, sireId?, groupId?, status (active/sold/deceased/archived), notes?, createdAt, updatedAt.
groups: id, name, location?, notes?, createdAt, updatedAt.
healthEvents: id, animalId, kind (checkup/illness/vaccination/treatment/other), occurredAt, vetName?, notes?, batchId?, createdAt, updatedAt.
vaccinations: id, healthEventId, animalId, productName, batchNumber?, administeredAt, nextDueAt?, vetName?, notes?.
treatments: id, healthEventId, animalId, medicineName, doseText?, startedAt, endedAt?, meatWithdrawalUntil?, milkWithdrawalUntil?, vetName?, notes?.
tasks: id, animalId?, title, description?, dueAt, status (open/done/cancelled), completedAt?, createdAt, updatedAt.
settings: key, value, updatedAt.
auditEvents: id, entityType, entityId, action, occurredAt, summary (avoid storing secrets).

Rules: never cascade-delete medical history; archive animals. Animal species must exist. Parent links cannot self-reference; avoid cycles. Vaccination/treatment references must match animalId of health event. Date checks (end >= start); no automatic medical scheduling. Database migration tests required.

## Versions 2 and 3

Version 2 adds `animalPhotos`, keyed by animal UUID, with the local photo blob.

Version 3 extends veterinary records in place. Health events add the `followUp` kind, optional reason, symptoms, findings, diagnosis, and follow-up date. Vaccination details add manufacturer, dose, and administration route. Treatments add reason, dose unit, administration route, and duration. Fields absent on older records remain absent. New clinical calendar dates use UTC midnight with `dateOnly: true`; creation timestamps remain UTC instants.

An amendment is a new event with the same animal and event type, an `amendsId` link and a required reason. The unique `amendsId` index prevents parallel amendments of the same version. Earlier records and any linked clinical details remain available.

`veterinaryOperations` stores the operation UUID, a SHA-256 fingerprint of the validated request, and the animal and event IDs that were committed. Batch events use the operation UUID as `batchId`. The receipt and all clinical records commit in one transaction. Retrying the same operation and payload returns the same receipt. Reusing the UUID with a different payload fails.

## Version 4

Tasks use an ISO calendar `dueDate`, a `type` (vaccination, checkup, treatmentFollowUp, or general), and a status (pending, completed, or cancelled). The migration maps open to pending and done to completed, assigns the general type, and derives the calendar date in the device’s local time zone while preserving each original `dueAt` timestamp. Task IDs, animal references, and creation, update and completion timestamps are preserved.

A veterinary reminder stores the original event ID in `healthEventId`, with a unique compound index on event ID and task type. The source is validated against the latest valid amendment during confirmation and resolved again when viewed. Editing a reminder’s due date does not alter the clinical record. Completed and cancelled tasks are retained.

The dashboard uses the existing `nextDueAt` vaccination index and the new `followUpAt` health-event index to find recorded dates in range. Follow-up dates may also be entered on treatments. They are separate from treatment end dates and withdrawal periods.
