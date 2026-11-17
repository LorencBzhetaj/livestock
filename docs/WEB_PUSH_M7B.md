# M7B secure push enrollment and delivery

**Status** — The PostgreSQL adapter and private operator workflow are implemented. Vercel project inspection returned HTTP 403 and no database was verified, provisioned or configured. Testing uses an embedded PostgreSQL engine and a mocked provider. Deployed delivery and the physical iPhone/Android runs are **NOT TESTED**. The M7A local preview sender remains available under its original restrictions.

## Boundary and retention

The same-origin Node API uses `GET /api/push` for public capability and the current cookie's enrollment and last recorded test status. `POST` accepts the actions `enroll`, `revoke`, and `test`. The server never lists subscriptions, returns a stored subscription, or accepts a request-supplied delivery destination. It is disabled without explicit opt-in and valid configuration. The Vercel production environment is always excluded for M7B. HTTPS and an exact Origin are required for mutations, with same-origin Fetch Metadata when present. No cross-origin grants or wildcard CORS are emitted.

An authorized operator issues a random 256-bit enrollment code bound to a server-designated principal UUID. Only its digest is stored. It expires after 15 minutes. The first valid enrollment fixes the subscription to that grant. An exact repeat with the same request UUID and payload can recover a lost enrollment response until the grant expires. A different payload or request UUID cannot reuse the grant. The API issues an HttpOnly, Secure, SameSite Strict host-only cookie with a signed server-generated device UUID. Device credentials never enter localStorage, Dexie, backups, or browser JavaScript. A cookie authorizes test sending and revocation for that device alone. It grants no access to farm data, administration, or other devices. Treat the grant and cookie as temporary bearer credentials.

The database holds the device and principal UUIDs, endpoint digest, AES-256-GCM encrypted subscription and expiry of at most 30 days, plus grant digests, fixed-window counters and request receipts. Store the encryption/signing key independently from PostgreSQL. Revocation, expiry and provider HTTP 404/410 remove the subscription and cascade its receipts. Mutation requests opportunistically purge expired entries and old quota buckets. Run the operator purge periodically if the preview has no traffic. Delete or revoke preview records and retire test keys at teardown. Receipts stay for the device lifetime so old request IDs cannot resend.

A short PostgreSQL transaction obtains a transaction-scoped advisory lock, then updates quotas and reserves a test receipt before any provider I/O. Database time defines the windows across replicas. Limits are 60 same-origin-shaped mutation attempts per minute globally, three enrollments per principal per hour, ten revocations per principal per hour and one test per minute and five per UTC day per principal. Failed authentication and malformed requests count toward the global limit. Origin is a CSRF defense and can be forged by a nonbrowser caller, so the global budget can be exhausted by an attacker. Use protected preview access and existing perimeter limits where available. Results are replayable using the same receipt ID. A timeout or process interruption after reservation leaves provider acceptance unknown, and retrying the same ID cannot dispatch a second push. Revocation stops new reservations. An already reserved test may complete.

Endpoint policy uses exact HTTPS host matches and restricts Google and Mozilla endpoint paths. The sender validates the P-256 and authentication keys, resolves IPv4, rejects any nonpublic or mixed DNS answer, and connects directly to the validated IP while verifying the original provider TLS name. There is no second lookup, proxy or redirect-following path. IPv6-only provider/network combinations and unlisted provider endpoints need additional review before support. Message data consists of a fixed test kind, UUID and language. Device delivery stays unverified after provider acceptance. The existing worker, offline data and backup format continue to work.

## Deployment checklist

1. With separate authorization, obtain a private PostgreSQL database with a serverless-compatible TLS endpoint. A managed free-tier-compatible provider can be used if approved. No provider is required by the code and none was created. Use a dedicated database or private schema, deny public network/client access where supported, and use certificate validation. Apply `server/push-schema.sql` with operator credentials. Give the runtime role only the table reads and writes it requires. Keep migration and grant-issuance credentials outside Vercel. Use an operator-controlled host for admin commands.
2. Generate a VAPID pair and independent 32-byte base64url server secret outside the browser. Use a private unversioned environment file or secret manager. Set the Preview environment variable names listed below. Never place private values in VITE-prefixed variables or in Git. Keep the Preview origin stable across tests. The branch config disables automatic deployment. A separately approved manual Preview deployment is required.
3. With an operator database connection and a server-assigned principal UUID, run `node scripts/push-admin.mjs issue` from a protected environment. It writes the grant only to a new absolute `.push-grant` file. Use a private directory outside the repository with owner-only access, including restrictive Windows ACLs. Transfer the code privately once and remove the file. The same tool accepts `migrate`, `purge` and `revoke`. For emergency revocation, an operator can look up the intended UUID using private database access and supply both principal and device UUIDs to the revoke command.
4. Verify the deployed Preview config reports enrollment enabled. Test one consenting device at a time. Leading and trailing spaces are outside the code format. Run the device steps below and record provider acceptance separately from device arrival.
5. Roll back by disabling the Preview opt-in and deploying that configuration only after approval. The production instance remains gated. Revoke Preview devices and remove test grants according to retention policy. An already accepted push cannot be recalled. Farm IndexedDB requires no migration or rollback.

| Environment variable name | Scope |
| --- | --- |
| `PUSH_DURABLE_TEST` | Explicit Preview opt-in |
| `PUSH_DATABASE_URL` | Runtime or operator PostgreSQL URL with `sslmode=verify-full`, separate credentials by role |
| `PUSH_SERVER_KEY` | Preview-only encryption and signing root |
| `PUSH_ALLOWED_ORIGIN` | Exact Preview HTTPS origin |
| `PUSH_VAPID_PUBLIC_KEY` | Public browser subscription key |
| `PUSH_VAPID_PRIVATE_KEY` | Server-only VAPID signing key |
| `PUSH_VAPID_SUBJECT` | Operator VAPID contact |
| `PUSH_PRINCIPAL_ID`, `PUSH_GRANT_FILE`, `PUSH_DEVICE_ID` | Operator-only administration inputs |

## Physical iPhone and Android checklist

| Check | Status |
| --- | --- |
| iPhone/iPad on iOS/iPadOS 16.4 or later — open the authorized Preview in Safari, add to Home Screen, launch standalone, grant permission, complete subscription, and enter the enrollment code. | NOT TESTED |
| Android — install the Preview using a compatible browser, grant permission, complete subscription, and enroll with a separate code. | NOT TESTED |
| Each device — send one test, background the app, note provider acceptance and arrival separately, tap it to check same-origin navigation, then revoke. | NOT TESTED |
| Each device — deny permission and verify no repeated prompt. Disconnect and reconnect while using the farm UI. Exercise expiry and revoke from another tab while verifying the original tab cannot send after refresh. | NOT TESTED |

The existing deployed URL is not an M7B delivery target. Apple documents the Home Screen and permission gesture requirements. [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## M8 synchronization and later roles

Introduce a verified server identity behind an authorization adapter that resolves a stable principal before performing any operation. Replace temporary grants with authenticated enrollment tied to that principal. Keep device proof and enrollment separate from user authorization. Plan a per-principal farm membership with capability checks at every API operation. An owner can mutate, manage access and restore. A veterinarian receives only authorized read projections and must fail all mutation, restore, import, settings and user-management endpoints. Neither role is implemented here.

For synchronization, preserve UUIDs, use an offline IndexedDB outbox, idempotent server operation IDs, versioned changes with tombstones and a scoped pull cursor. Use explicit conflict handling for animal identity and task edits, append-only clinical amendments, transactional authorization, and backup compatibility tests. Keep test pushes separate from the sync transport. Scheduler work needs separate consent and should derive reminders from the correct local timezone and a versioned task revision without including farm data in delivery payloads.
