# LivestockOS

An Albanian-first, offline-first livestock register for a private farm. The first release supports a single local workspace and a database that can represent goats, sheep, cattle and other species.

## Sign in to M8 Preview

Open the protected Preview and sign in with `adi` and the existing Admin password. Keep **Mbaje mend këtë pajisje / Remember this device** selected on a private device. Normal sign-in needs no setup code. To activate `vet`, open **Cilësimet / Settings → Llogaria e veterinerit / Veterinarian account**, choose a password of at least 12 characters and confirm with the Admin password. The veterinarian can view farm records but cannot change them.

On iPhone, open the same Preview in Safari, choose **Share → Add to Home Screen**, launch the installed app and sign in with the same account. On a new device, review the farm records and confirm once before synchronization starts. Synchronization then runs on opening, reconnecting, returning to the app and saving changes. Pending offline changes are retained. Photographs remain local and in backups. See [account security and cache behavior](docs/ACCOUNTS.md).

## Run locally

Use Node.js 24 LTS and npm. Install the locked dependencies once with internet access.

```sh
npm ci
npm run dev
```

Open the address shown by Vite. The farm starts empty. To load sample records, open **Cilësimet** and select **Shto të dhënat DEMO**. The app adds three sample goats once per browser database. It does not overwrite existing records. **Gjuha** switches between Shqip and English.

## Verify the build and offline mode

```sh
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

For a manual check, run `npm run preview` and open the localhost address in a regular browser profile. The production build registers a service worker on localhost or HTTPS. The development server does not enable offline caching.

- [ ] Confirm the app opens in Shqip with zero animals in a fresh browser profile.
- [ ] In browser developer tools, wait for the service worker to activate, switch the network to offline and reload.
- [ ] Confirm the header shows **Pa internet** and **Vetëm në këtë pajisje**.
- [ ] Add demo data in **Cilësimet**, switch to English and reopen the page while still offline. Confirm **Overview** shows three active animals.
- [ ] Use the keyboard to move through the navigation and settings. Check the browser install flow on the farm's target phone and computer.

Playwright exercises the reload and persistence checks on desktop Chromium and a 390 px Chromium viewport. Installation from a physical phone or computer can be checked separately using the browser's install menu.

## Local data and milestone scope

Records are stored in IndexedDB for the current browser profile and app origin. The development and preview servers use different origins by default. Each device has its own data. Settings can request persistent storage, subject to browser support and permissions.

Browser storage can be cleared or evicted. Keep a verified backup outside the browser before relying on this device. M2 upgrades existing v1 databases in place by adding a separate table for photographs. Existing animal IDs and veterinary records are preserved.

## Animal registry checks

1. Open **Kafshët** and choose **Shto kafshë**. Keep the default species **Dhi**, enter a test tag, name and sex, and optionally attach a JPG, PNG or WebP image up to 5 MB. Save, open the profile, and edit a field. Try creating another active animal with the same tag in a different case.
2. Search by tag or name and combine species, breed, sex, age and status filters. From a profile, choose **Arkivo kafshën** and confirm. Filter by archived status and reopen the animal.
3. Choose **Importo CSV** and download the template. Use the columns shown in the template, UTF-8 encoding, comma separators, and ISO dates (`YYYY-MM-DD`). Required columns are `earTag`, `species` and `sex`. Blank status defaults to `active`. The 2 MB import accepts identification fields and notes. Add photographs from the form.
4. Preview a file with a missing tag and two differently cased copies of a tag. Check the row errors and disabled confirmation. Preview a corrected file with about 200 unique tags and confirm that the count changes only after confirmation. Import rejects tags already in the registry, including archived records. The single-animal form allows reuse once the prior animal is inactive.
5. Build and run the preview server, let the service worker activate, then go offline. Reopen a profile URL, edit an animal, and reload to confirm the changes and photo persist. Repeat at 390 px, and use **Cilësimet → Gjuha** to check both languages.

## Veterinary management checks

1. Open an animal profile and choose **Shto ngjarje veterinare**. Record a test checkup, vaccination, and treatment. Enter the clinical dates yourself. Reopen each event from **Historiku veterinar** and check the details and newest-first order.
2. Open an event and choose **Shto korrigjim**. Enter a reason, save a correction, and follow the link to the prior record. Archive the animal and confirm that both versions are still available.
3. Open **Veterinaria → Vaksinim në grup**. Filter active animals by group or species, select individuals or all matches, and enter test vaccine details once. Check every selected tag and the total in the preview. Confirm once, then open a saved entry and check the batch operation ID.
4. Build and start the preview server. Once its service worker has activated, test saving and reopening an event URL offline. Repeat at 390 px and switch languages under **Cilësimet → Gjuha**.

M3 upgrades IndexedDB to v3 in place. It adds a veterinary operation receipt store and a unique amendment index. Existing health records and M0–M2 data stay in their original stores. In-progress forms and previews are held in the open page. After a refresh, check the timeline before entering the batch again. The veterinary overview shows the 100 most recent entries, and each animal profile shows its full history.

Clinical dates in new records are stored as UTC date-only values and displayed as entered. Creation timestamps show the device’s time zone. Follow-up, next vaccination and withdrawal dates are optional fields entered by the owner. Treatment duration is recorded as entered. These dates do not create reminders in M3.

## Dashboard, calendar and reminder checks

1. Open **Përmbledhje**. Compare the registered, active, archived and species totals with the animal registry. Open **Kalendari** and use **Shto detyrë** to create a test task for today and another for a past date. Verify the dashboard counts and calendar agenda.
2. Open a calendar entry, edit and reschedule it, then complete it. Cancel a different task and use the calendar status filter to find each closed record.
3. Open a veterinary event with a recorded next date. Choose **Krijo kujtesë**, review the date, and confirm. Open both the original and amended event and check that they link to a single reminder. If a date changes later, the task links to the latest record and keeps its saved due date until the owner reschedules it.
4. After the production service worker has activated, go offline and reopen a task URL. Check the dashboard and calendar at 390 px and switch languages under **Cilësimet → Gjuha**.

Dashboard task windows use the device’s local calendar. Today, days 1–7, and days 1–30 are separate counts, with the 7-day count included in the 30-day count. The calendar shows pending tasks through 30 days ahead and all overdue pending tasks. Recorded future vaccination and examination dates appear as clinical information before a reminder is created. Reminders appear in the app and do not use background notifications.

M4 upgrades IndexedDB to v4 in place. Legacy task timestamps are preserved, and each task gets a calendar due date based on the device time zone at migration. Task creation and completion timestamps remain UTC instants.

## Backup and restore checks

1. Use a separate test browser profile. Open **Cilësimet → Kopje rezervë dhe rikthim**, download a backup, and note its size.
2. Add or change a test record, then select the downloaded JSON. Check the preview and confirm that the test change is still present before you confirm replacement.
3. Confirm replacement and reopen the dashboard and an animal profile. Check original records, photos, and settings. With a second tab open, verify that it shows a restore notice without discarding an open draft.
4. Repeat with the production service worker active and the browser offline. Check both interface languages and a 390 px viewport.

Backups are unencrypted private files. Keep copies in locations you control, and test restores with synthetic data. See the [backup format and compatibility policy](docs/BACKUP_AND_SYNC.md).

See the [PWA compatibility and update policy](docs/PWA_READINESS.md) and the [physical-device checklist](docs/PHYSICAL_DEVICE_CHECKLIST.md). The physical iPhone, Android, and desktop installation checks remain **NOT TESTED**.

See [M7A Web Push](docs/WEB_PUSH.md) for test-only authorization, environment setup and the device delivery checklist. See [the roadmap](docs/ROADMAP.md) and [the implementation guidance](AGENTS.md).

The current mockup-based interface and authenticated Preview reminders are described in [the release and notification guide](docs/REMINDERS_RELEASE.md). Normal device notification setup is in Settings and uses the signed-in Admin account. Background scheduling remains visibly pending until its authorized external trigger has been configured and verified; no physical delivery is claimed.
