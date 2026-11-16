# Acceptance criteria and test scenarios

1. Add 200 goats, unique ear tags; list/search works quickly and without internet.
2. Reopen browser offline; records remain available.
3. Create vaccination with explicit date and optional due date; appears on timeline and dashboard task if created.
4. Create treatment with withdrawal dates entered by user; never generated automatically.
5. Batch vaccinate 20 animals: exactly 20 linked events, no duplicates on retry; transaction rollback on failure.
6. Archive one animal: its health history remains readable.
7. Import CSV with duplicate tags: preview shows conflicts; no silent overwrite.
8. JSON backup export then restore to empty database: same counts and IDs; validate version, corruption, duplicates and broken references before committing.
9. Rejected restore must leave existing database unchanged.
10. App shows honest status: offline, local-only, not synced; no implication that second device has identical data.
11. Albanian labels work; English toggle optional. Accessible labels and keyboard forms.
12. Test 200 goats plus 1000 health events, no data loss; responsive at 390px and desktop.
13. Confirm phone/desktop manual backup transfer; document that automatic sync is future work.
