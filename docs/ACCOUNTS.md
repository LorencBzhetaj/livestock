# Username and password accounts

The M8 Preview uses exactly one ADMIN and one VETERINARIAN per farm. The fixed usernames are `adi` (ADMIN) and `vet` (VETERINARIAN). Passwords contain 12–128 characters. The server hashes passwords with Node's scrypt using N=131072, r=8, p=1, a random 16-byte salt and a 64-byte key. Password hashes never appear in API responses. No default passwords are supplied.

## Initial owner setup

An operator verifies the isolated Neon branch and database and prepares a one-use owner setup grant for the existing farm using `scripts/auth-setup.mjs`. The grant expires after 24 hours. The script takes an absolute private `.setup-code` file path and reads `SYNC_OPERATOR_DATABASE_URL`, `AUTH_SETUP_FARM_ID` and `AUTH_SETUP_EXPECTED_HOST` privately. Use a directory restricted to the owner and keep the file outside Git. Opening the setup form alone cannot claim a farm. After setup, devices sign in with the chosen username and password.

At the protected Preview, choose **First visit? Set up adi**, enter the private setup code and choose a strong password. Device names are assigned automatically. A newly authenticated Admin can explicitly adopt the original local cache when it belongs to the same farm identity. Otherwise the account opens a separate cache. The initial synchronization review still requires confirmation. Existing records and pending operations are retained.

The Admin opens **Settings → Veterinarian account**, sets the password for the fixed `vet` username and reenters their own current password. Saving an existing Vet username resets that password, activates the account and revokes its sessions. At most one account of each role can exist per farm. The Vet signs in normally and explicitly reviews the remote records before caching them.

## Sessions and permissions

The opaque session credential is kept in a Secure, HttpOnly, SameSite Strict cookie. Session tokens are stored as digests in PostgreSQL and checked against the active account, farm membership, expiry and device revocation. A regular session lasts 12 hours. Remember this device lasts 30 days. Reauthentication is required to create or reset the Vet account. Failed sign-in attempts use shared database limits per username, source and globally.

The sync API returns HTTP 403 for Vet push, device management and invitation requests. Legacy enrollment grants cannot create account sessions when authentication is enabled. The push-test endpoint also checks the authenticated Admin role. The Vet interface disables farm forms and the Dexie middleware rejects local writes, including direct table mutations. Remote pull application receives a transaction-specific permission. Backup export and restore require Admin access. Remote photo storage remains unavailable until the separate M8 storage integration is completed.

Each account has its own IndexedDB v5 cache. A logout hides the cached app and locks repository reads. It preserves cached records and pending Admin operations. Offline logout requires a fresh online sign-in before switching accounts. Other tabs lock after a logout or account switch. Reconnection or focus rechecks server authorization. An offline device can read its cached records until the cached session expiry. Revocation is observed when it reconnects. This does not provide encryption against someone with access to the browser profile or developer tools.

## Preview activation

Apply `server/auth-schema.sql` only to the isolated `livestock_m8_preview` database after target verification. It adds three account tables and nullable session columns to devices, preserving existing farms and records. Configure `AUTH_ENABLED=1` and public build flag `VITE_AUTH_REQUIRED=1` only for the M8 Preview branch alongside the existing M8 runtime connection and origin. The final Admin/Vet roles are now implemented here. Production deployment requires a separate migration review and authorization.

Tests cover password checks and throttling, private setup, session expiry and revocation, HTTP authorization and farm isolation, direct offline mutation denial, and account cache separation. Run the authentication browser scenario against a build with `VITE_AUTH_REQUIRED=1` and `AUTH_E2E=1`. The standard regression build keeps its existing offline standalone workflow for tests. Existing backup payload format v1 and IndexedDB v5 remain compatible.
