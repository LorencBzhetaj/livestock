-- Apply as the schema owner after reviewing the deployment target.
-- Set the password privately before enabling LOGIN or configuring Vercel.
BEGIN;
CREATE ROLE livestock_sync_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA livestock_sync TO livestock_sync_runtime;

GRANT SELECT ON livestock_sync.farms, livestock_sync.farm_members TO livestock_sync_runtime;
GRANT UPDATE (cursor) ON livestock_sync.farms TO livestock_sync_runtime;
GRANT SELECT, INSERT ON livestock_sync.devices TO livestock_sync_runtime;
GRANT UPDATE (revoked_at) ON livestock_sync.devices TO livestock_sync_runtime;
GRANT SELECT, INSERT ON livestock_sync.enrollment TO livestock_sync_runtime;
GRANT UPDATE (used_at) ON livestock_sync.enrollment TO livestock_sync_runtime;
GRANT SELECT, INSERT, DELETE, UPDATE (attempts) ON livestock_sync.quota TO livestock_sync_runtime;
GRANT SELECT, INSERT ON livestock_sync.receipts, livestock_sync.changes TO livestock_sync_runtime;

GRANT SELECT, INSERT ON livestock_sync.health_events, livestock_sync.vaccinations,
  livestock_sync.treatments, livestock_sync.veterinary_operations TO livestock_sync_runtime;
GRANT SELECT, INSERT, UPDATE (version,payload) ON livestock_sync.species,
  livestock_sync.animal_groups, livestock_sync.animals, livestock_sync.tasks TO livestock_sync_runtime;
COMMIT;
