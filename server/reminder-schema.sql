-- Additive, isolated M8 Preview only. Existing M7B tables and records are retained.
BEGIN;
CREATE TABLE livestock_sync.reminder_devices (
 sync_device_id uuid PRIMARY KEY REFERENCES livestock_sync.devices(id),
 push_device_id uuid NOT NULL UNIQUE REFERENCES public.livestock_push_devices(id) ON DELETE CASCADE,
 preferences jsonb NOT NULL
);
GRANT SELECT,INSERT,UPDATE,DELETE ON livestock_sync.reminder_devices TO livestock_sync_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.livestock_push_devices,public.livestock_push_receipts,public.livestock_push_quota TO livestock_sync_runtime;
GRANT SELECT,DELETE ON public.livestock_push_grants TO livestock_sync_runtime;
COMMIT;
