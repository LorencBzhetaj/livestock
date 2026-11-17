# M7A Web Push

Settings reports the runtime capabilities, display mode, permission and browser subscription state. Enabling takes separate explicit actions to request permission and create a subscription. A denied permission is managed in browser or OS settings. Disabling unsubscribes on this device. The time, language and lead time are local preferences and do not schedule delivery. Offline farm features still use IndexedDB. Schema v4 and backup format v1 remain in use. Only validated preferences are included in new backups. Older builds may reject a backup containing the new preference key.

The service worker uses Workbox precaching, preserves the M6 waiting-worker policy, and excludes API navigation from the shell fallback. The shared push schema permits only a test kind, a UUID and a language. The worker supplies fixed text, deduplicates recent IDs with a bounded local cache, and uses the notification tag as a fallback. A click focuses an existing in-scope window without changing its route, or opens the scoped Settings URL. Neither subscriptions nor tokens are cached. The deduplication cache holds the last 64 IDs and can be evicted.

## Authorization and Vercel

The current HTTPS alias returned 200 for the root and 404 for a direct Settings request. The checked-in Vercel configuration adds a history fallback that excludes API paths and static files, and disables Git-triggered deployment for the M7A branch. The Vercel project API did not grant account access for inspection. This milestone changes neither the running deployment nor its environment.

`GET /api/push` returns a public VAPID key if configured, plus the test availability flag. The Vercel Node adapter rejects all POST sends with HTTP 503. It has no approved durable rate limiter shared by its replicas, authenticated owner/device enrollment, or private subscription persistence. A future approved adapter would need a transactional store or an enforced platform quota keyed to an authenticated principal and target. Storage must be private, access-controlled and support expiry/revocation. No provider is added here.

The opt-in single-process preview adapter is for operator-controlled testing. The operator pins one subscription in private process configuration and shares a random bearer token with the test operator only. The request can identify only the pinned destination by SHA-256 endpoint hash. The exact origin is checked and no cross-origin access headers are emitted. Browser Origin checks supplement bearer authorization. The body is capped at 1 KiB, and the destination must be on an approved HTTPS push host. The process allows one attempt per minute and at most five per run. Provider HTTP 404 or 410 invalidates the pin for that process. The app attempts to remove its expired browser subscription. The quota resets on restart. Keep the test origin private and use one process only. The sender reports acceptance after the provider acknowledges it. Delivery depends on the device, network, OS and provider. No farm information is sent.

| Environment variable name | Purpose |
| --- | --- |
| `PUSH_VAPID_PUBLIC_KEY` | Browser subscription key. This is the sole optional variable used by the disabled Vercel adapter. |
| `PUSH_VAPID_PRIVATE_KEY` | Server-only signing key for the preview sender. |
| `PUSH_VAPID_SUBJECT` | Valid operator contact in mailto format. |
| `PUSH_ALLOWED_ORIGIN` | Exact HTTPS test origin. Plain HTTP is limited to 127.0.0.1 with an explicit port. |
| `PUSH_TEST_TOKEN` | Server-side 32-byte random bearer token encoded as unpadded base64url. |
| `PUSH_TEST_SUBSCRIPTION` | Private single-line JSON from one browser subscription. |
| `PUSH_LOCAL_TEST` | Explicit single-process preview opt-in. The Vercel adapter ignores it. |

Never use a VITE-prefixed name for a private value. Keep local configuration in an ignored `.env.push.local` file with restricted permissions. Clipboard contents and subscriptions are private and belong outside source, logs and ordinary messages.

## Reproducible authorized test

1. With the locked dependencies installed, generate a VAPID pair outside the app. For PowerShell, capture it without echoing values with `$vapid = npx web-push generate-vapid-keys --json | ConvertFrom-Json`. Generate the operator token locally from 32 cryptographically random bytes. Populate private configuration using the variable names above.
2. Run `npm run build`. Start one loopback preview process using `node --env-file=.env.push.local node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort`. For a phone, place the loopback service behind a trusted, private HTTPS reverse proxy and set the exact public-facing origin. Keep the origin fixed between pairing and sending.
3. With the public key configured, open Settings in the test app. Grant permission, then select **Complete push setup**. Select **Copy subscription for operator**, transfer it privately into the pinned configuration, and clear the clipboard. Restart the one preview process with the pin and explicit opt-in enabled, and reload Settings.
4. Enter the operator token, tap **Send test notification** once and check the acceptance message and the device. To exercise background delivery, background the app immediately after initiating the request. Tap the delivered notification. An open LivestockOS window should retain its current page. Without an open window, the app should open Settings. Unsubscribe and stop the test process when done.

The current Vercel deployment cannot send test notifications with this adapter. An authorized deployment and approved shared rate-limiting/enrollment design are separate steps.

## Push delivery device checklist

| Device flow | Status |
| --- | --- |
| iPhone/iPad with iOS/iPadOS 16.4 or later, install the authorized HTTPS test build to the Home Screen, launch standalone, grant permission via Settings, pair and send once, verify delivery after backgrounding, tap and check navigation. | NOT TESTED |
| Android in a compatible browser, install the authorized HTTPS test build, repeat permission, pairing, background delivery, and click navigation. | NOT TESTED |
| On each device, deny permission or disable the subscription and verify offline registry access and the absence of repeated permission prompts. Record device, OS, browser, revision, provider acceptance and observed delivery separately. | NOT TESTED |

Apple documents the Home Screen and user-interaction requirements. Android support depends on the actual Push and Notification APIs and device settings. [Apple Web Push guidance](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [WebKit Home Screen support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## M7B

See the [secure enrollment and delivery guide](WEB_PUSH_M7B.md) for the opt-in durable Preview workflow and device checklist.
