# Physical device validation

**NOT TESTED on physical hardware.** Run this checklist on a disposable origin or browser profile with synthetic records only. Keep notes on the device model, OS version, browser version, commit, date, and result for each check. The 390 px Chromium project tests a viewport and touch settings. Physical Safari, Chrome, standalone behavior, and phone memory limits still need verification.

## Installation

1. Build with `npm run build`. Serve the entire `dist` directory on a device-reachable **trusted HTTPS** test origin, with static assets and `sw.js` served directly and application routes falling back to `index.html`. Keep the scheme, host and port stable across both test releases. Plain HTTP on a desktop LAN address is unsuitable for phone service workers. `npm run preview` on the same desktop can use the localhost exception.
2. **iPhone Safari** — open the test URL, tap **Share → Add to Home Screen**, enable **Open as Web App** if shown, and tap **Add**. Launch LivestockOS using its icon. [Apple’s iPhone instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
3. **Android Chrome** — open the same test URL, use the overflow menu and choose **Install** or **Install and create shortcut → Install**, as offered. Open the app from the launcher. [Chrome Android instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid)
4. **Desktop Chrome or Edge** — open the build and use the browser’s install action in the address bar or menu when offered. Use a normal profile and confirm the browser opens the installed app in a separate window. [Chrome install criteria](https://web.dev/articles/install-criteria)
5. In the installed app, open **Settings → Local storage** and wait for the offline-ready message before turning off the network.

## iPhone checks

| Check | Steps | Physical result |
| --- | --- | --- |
| Install and standalone | Follow the Safari steps. Open the icon and confirm the app opens without the normal Safari address bar. | NOT TESTED |
| Cold offline launch and direct routes | After the offline-ready message, enable airplane mode and turn off Wi-Fi. Close and reopen the Home Screen app. Open animals, calendar, veterinary details and Settings. | NOT TESTED |
| Animals | Create and edit a synthetic animal offline, change its tag or name, then reopen its profile. | NOT TESTED |
| Photographs | Add an allowed photo below 5 MiB. Save and verify it displays after relaunch. Try selecting a HEIC file and verify the app explains the allowed formats if the picker returns HEIC. | NOT TESTED |
| Veterinary events | Record a test examination and vaccination. Open the timeline and confirm the saved details. | NOT TESTED |
| Tasks and reminders | Create a task, then explicitly create a reminder from a recorded follow-up date. Check the calendar and reopen both entries. | NOT TESTED |
| Backup download | While offline, use **Settings → Backup & restore**. Verify a nonempty JSON file is accessible in Files. Check **On My iPhone** if using a local destination. | NOT TESTED |
| Backup import and restore | Change a synthetic record, select the saved file from Files, check the preview, then confirm. Check the restored IDs, photo, tasks, and settings. Run again with a photo-heavy file starting well below the limit. | NOT TESTED |
| Closing during restore | On the disposable installation, switch away and terminate the app during a photo-heavy restore. Reopen and compare records. The result must be the complete old database or the complete restored database. | NOT TESTED |
| Service worker update | Use two builds with a visible test label change on the same HTTPS origin. Start a draft in build A, serve build B, and check that a waiting-update notice does not reload the draft. Save it. When all restores have finished, close the app and any Safari tabs for the test origin. Reopen online, check the new label and prior records, then reopen offline. | NOT TESTED |
| Repeated relaunch | Close the standalone app twice, reopen offline, and check a saved record and downloaded backup in Files. | NOT TESTED |

## Android and desktop checks

| Platform | Checks | Physical result |
| --- | --- | --- |
| Android Chrome | Repeat install, standalone launch, offline navigation and relaunch, photograph picker, download/import, and the two-build update check. Verify the launcher icon and Android Files workflow. | NOT TESTED |
| Desktop Chrome or Edge | Repeat install, offline reload, download/import, and update with an open draft. Check keyboard navigation and resize to 390 px. | NOT TESTED |

## Device limits and recovery

- Supported photos are JPEG, PNG and WebP. An iPhone may provide HEIF/HEIC. Use an exported JPEG or set **Settings → Camera → Formats → Most Compatible** for new photos if that option is available. [Apple HEIF guidance](https://support.apple.com/en-us/116944)
- Home Screen and Safari browser storage can be separate. Verify storage and restore from inside the installed app. Record which origin and profile were tested. WebKit can evict origin data under storage pressure, and persistence requests depend on browser heuristics. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- File picker, download destination, and install menu vary by OS and browser. Put the test backup in device-local storage for offline checks. App files and data stay on the HTTPS origin used at install. Keep a verified backup outside the app before changing origins, uninstalling, or clearing browser data.
- The 128 MiB ceiling bounds file size. A lower-memory device may fail earlier. Test the farm’s photo volume on the actual iPhone before relying on large restores. [Backup format and limits](BACKUP_AND_SYNC.md)
