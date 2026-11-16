# Data protection and synchronization

Phase 1: each device has its own independent IndexedDB database. Choose one primary device to edit until tested sync exists. Use manual export/import to transfer to another device; do not independently edit both copies because manual merges are not guaranteed.

Backups: provide one-click versioned JSON export with exportedAt, appVersion, schemaVersion, table counts and checksum. Validate checksum and referential integrity before import. Do not store encryption passwords in the app. If encryption not yet implemented, label files as sensitive and unencrypted. Keep two copies on separate devices/locations, at least weekly and after major veterinary work; perform a restore drill monthly. Provide clear warnings before replace-import. Store files in a user-chosen folder, not just browser cache.

## M5 backup format

A backup is a UTF-8 JSON document ending in `.backup.json`. The supported combination is format `livestockos-backup`, `formatVersion: 1`, and `schemaVersion: 4`. The envelope includes `exportedAt` in UTC, `counts` keyed by collection, `data`, and a lowercase hex SHA-256 `checksum`. To compute the checksum, serialize the first six fields in that order with compact ECMAScript `JSON.stringify` and hash the UTF-8 bytes. Preserve property order inside counts and data. Whitespace formatting outside strings does not affect the check. SHA-256 detects accidental corruption. Authenticity and encryption require separate mechanisms.

The payload includes all 11 application stores. Photos include the animal ID, MIME type, original byte size, and base64 content. The settings collection allows the current app-owned keys `language`, `demoSeeded`, and `notificationPreferences`. Push subscriptions and operator tokens stay outside backups. Audit entries retain their historical entity IDs. The file limit is 128 MiB, including base64 overhead. Snapshot reads share one transaction. Photo encoding and decoding run one photo at a time. JSON and Web Crypto still require in-memory buffers, so photo-heavy backups may need substantial device memory.

Files with unsupported format or database schema versions are rejected. Future readers must add an explicit validator and converter before accepting another version. M5 keeps the existing IndexedDB v4 schema.

Preview validates the entire file without writes. Confirmed restore replaces all application stores in one IndexedDB transaction. A failure aborts the replacement. Concurrent writes are ordered by IndexedDB. Open app tabs receive a notice after commit when BroadcastChannel is available, and Dexie subscriptions observe committed changes. The notice leaves open drafts intact and asks the owner to reopen a peer tab before editing the restored records. The replacement includes the data present at confirmation, so finish other edits before restoring. Retrying the same validated file replaces records by their original IDs. The restore does not create new reminders.

Future sync: encrypted HTTPS API, per-device UUID, operation IDs, idempotency, server revision, pull cursor, conflict UI. Medical events append-only, no last-write-wins for clinical data; show conflict when concurrent edits occur. Backups independent of sync.
