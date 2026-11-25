-- LivestockOS M8 Production migration: accounts, multi-device sync and reminders.
-- Additive only. It creates the livestock_sync schema and the NOLOGIN runtime role,
-- and has the M7B table owner grant that role access to the four existing push tables
-- (plus REFERENCES on livestock_push_devices to the migration role, for one foreign key).
-- No existing table, row or role is dropped, truncated, altered or deleted; the only
-- membership change is temporary and is revoked inside the same transaction.
--
-- Run as the database owner role on the Production branch with psql, in ONE session:
--   psql "<owner connection, sslmode=verify-full, NOT pooled>" -v ON_ERROR_STOP=1 \
--        -v expected_database=<production database name> -f server/production-m8.sql
-- Any failed check raises an error and the whole transaction rolls back.
-- Take and verify a Neon snapshot first (docs/RECOVERY.md).

\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'Set -v expected_database=<name>. Nothing was changed.'
  \quit
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SELECT set_config('livestock.expected_database', :'expected_database', true);

-- Preconditions: right database, nothing from M8 yet, all four M7B tables present.
DO $$
DECLARE missing text; m7b_owner text;
BEGIN
  IF current_database() <> current_setting('livestock.expected_database') THEN
    RAISE EXCEPTION 'Connected to %, expected %', current_database(), current_setting('livestock.expected_database');
  END IF;
  IF current_database() = 'livestock_m8_preview' THEN
    RAISE EXCEPTION 'This migration is for Production, not the M8 Preview database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'livestock_sync') THEN
    RAISE EXCEPTION 'Schema livestock_sync already exists: migration already applied or partial. Stop and inspect.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'livestock_sync_runtime') THEN
    RAISE EXCEPTION 'Role livestock_sync_runtime already exists. Stop and inspect its attributes and grants.';
  END IF;
  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY['livestock_push_devices','livestock_push_grants',
    'livestock_push_quota','livestock_push_receipts']) t WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Expected M7B tables are missing: %', missing;
  END IF;
  -- On Neon the M7B tables belong to a separate migrator role. The owner role holds ADMIN
  -- on it without INHERIT or SET, so it may only act as that role through a membership it grants
  -- itself for this transaction and revokes again below.
  SELECT min(pg_get_userbyid(relowner)) INTO m7b_owner FROM pg_class
   WHERE oid IN ('public.livestock_push_devices'::regclass, 'public.livestock_push_grants'::regclass,
     'public.livestock_push_quota'::regclass, 'public.livestock_push_receipts'::regclass);
  IF (SELECT count(DISTINCT relowner) FROM pg_class WHERE oid IN ('public.livestock_push_devices'::regclass,
     'public.livestock_push_grants'::regclass, 'public.livestock_push_quota'::regclass, 'public.livestock_push_receipts'::regclass)) <> 1 THEN
    RAISE EXCEPTION 'The four M7B tables do not share one owner. Stop and inspect.';
  END IF;
  IF m7b_owner <> current_user AND NOT EXISTS (SELECT 1 FROM pg_auth_members
     WHERE roleid = m7b_owner::regrole AND member = current_user::regrole AND admin_option) THEN
    RAISE EXCEPTION 'Role % must own the M7B tables or hold ADMIN on their owner %', current_user, m7b_owner;
  END IF;
  PERFORM set_config('livestock.m7b_owner', m7b_owner, true);
  PERFORM set_config('livestock.migration_role', current_user, true);
END $$;

-- sync-schema.sql
CREATE SCHEMA livestock_sync;
SET LOCAL search_path = livestock_sync, pg_catalog;

CREATE TABLE migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL DEFAULT current_user);

CREATE TABLE farms (id uuid PRIMARY KEY, name text NOT NULL, cursor bigint NOT NULL DEFAULT 0);
CREATE TABLE identities (id uuid PRIMARY KEY);
CREATE TABLE farm_members (farm_id uuid REFERENCES farms, identity_id uuid REFERENCES identities,
  PRIMARY KEY (farm_id, identity_id));
CREATE TABLE devices (
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, identity_id uuid NOT NULL, label text NOT NULL,
  token_digest text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  FOREIGN KEY (farm_id, identity_id) REFERENCES farm_members,
  UNIQUE (farm_id, id)
);
CREATE TABLE enrollment (
  code_digest text PRIMARY KEY, farm_id uuid NOT NULL, identity_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz,
  FOREIGN KEY (farm_id, identity_id) REFERENCES farm_members
);
CREATE TABLE quota (bucket bigint NOT NULL, scope text NOT NULL, attempts integer NOT NULL, PRIMARY KEY (bucket, scope));
CREATE TABLE receipts (
  farm_id uuid NOT NULL, device_id uuid NOT NULL, id uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY (farm_id, id), FOREIGN KEY (farm_id, device_id) REFERENCES devices(farm_id, id)
);
CREATE TABLE changes (
  farm_id uuid REFERENCES farms, cursor bigint NOT NULL, entity text NOT NULL, record_id uuid NOT NULL,
  version bigint NOT NULL, payload jsonb, PRIMARY KEY (farm_id, cursor)
);

CREATE TABLE species (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  code text GENERATED ALWAYS AS (payload->>'code') STORED,
  PRIMARY KEY (farm_id,id), UNIQUE (farm_id,code)
);
CREATE TABLE animal_groups (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (farm_id,id)
);
CREATE TABLE animals (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  species_id uuid GENERATED ALWAYS AS ((payload->>'speciesId')::uuid) STORED,
  group_id uuid GENERATED ALWAYS AS ((payload->>'groupId')::uuid) STORED,
  dam_id uuid GENERATED ALWAYS AS ((payload->>'damId')::uuid) STORED,
  sire_id uuid GENERATED ALWAYS AS ((payload->>'sireId')::uuid) STORED,
  PRIMARY KEY (farm_id,id),
  FOREIGN KEY (farm_id,species_id) REFERENCES species,
  FOREIGN KEY (farm_id,group_id) REFERENCES animal_groups,
  FOREIGN KEY (farm_id,dam_id) REFERENCES animals DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (farm_id,sire_id) REFERENCES animals DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX active_ear_tags ON animals(farm_id,(payload->>'earTag')) WHERE payload->>'status' = 'active';
CREATE TABLE health_events (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  animal_id uuid GENERATED ALWAYS AS ((payload->>'animalId')::uuid) STORED,
  kind text GENERATED ALWAYS AS (payload->>'kind') STORED,
  amends_id uuid GENERATED ALWAYS AS ((payload->>'amendsId')::uuid) STORED,
  PRIMARY KEY (farm_id,id), UNIQUE (farm_id,id,animal_id,kind), UNIQUE (farm_id,amends_id),
  FOREIGN KEY (farm_id,animal_id) REFERENCES animals,
  FOREIGN KEY (farm_id,amends_id,animal_id,kind) REFERENCES health_events(farm_id,id,animal_id,kind)
);
CREATE TABLE vaccinations (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  event_id uuid GENERATED ALWAYS AS ((payload->>'healthEventId')::uuid) STORED,
  animal_id uuid GENERATED ALWAYS AS ((payload->>'animalId')::uuid) STORED,
  kind text GENERATED ALWAYS AS ('vaccination') STORED,
  PRIMARY KEY (farm_id,id), UNIQUE (farm_id,event_id),
  FOREIGN KEY (farm_id,event_id,animal_id,kind) REFERENCES health_events(farm_id,id,animal_id,kind)
);
CREATE TABLE treatments (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  event_id uuid GENERATED ALWAYS AS ((payload->>'healthEventId')::uuid) STORED,
  animal_id uuid GENERATED ALWAYS AS ((payload->>'animalId')::uuid) STORED,
  kind text GENERATED ALWAYS AS ('treatment') STORED,
  PRIMARY KEY (farm_id,id), UNIQUE (farm_id,event_id),
  FOREIGN KEY (farm_id,event_id,animal_id,kind) REFERENCES health_events(farm_id,id,animal_id,kind)
);
CREATE TABLE veterinary_operations (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (farm_id,id)
);
CREATE TABLE tasks (
  farm_id uuid REFERENCES farms, id uuid, version bigint NOT NULL, payload jsonb,
  animal_id uuid GENERATED ALWAYS AS ((payload->>'animalId')::uuid) STORED,
  event_id uuid GENERATED ALWAYS AS ((payload->>'healthEventId')::uuid) STORED,
  kind text GENERATED ALWAYS AS (payload->>'type') STORED,
  PRIMARY KEY (farm_id,id), UNIQUE (farm_id,event_id,kind),
  FOREIGN KEY (farm_id,animal_id) REFERENCES animals,
  FOREIGN KEY (farm_id,event_id) REFERENCES health_events
);

-- auth-schema.sql (tables) and account-usernames.sql (constraint; there are no rows to rename)
CREATE TABLE accounts (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, identity_id uuid NOT NULL,
 username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,40}$'),
 role text NOT NULL CHECK (role IN ('ADMIN','VETERINARIAN')), password_hash text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 UNIQUE(farm_id,role), UNIQUE(id,farm_id,identity_id),
 FOREIGN KEY(farm_id,identity_id) REFERENCES farm_members,
 CONSTRAINT account_role_username CHECK ((role='ADMIN' AND username='adi') OR (role='VETERINARIAN' AND username='vet'))
);
ALTER TABLE devices ADD COLUMN account_id uuid;
ALTER TABLE devices ADD COLUMN expires_at timestamptz;
ALTER TABLE devices ADD CONSTRAINT device_account FOREIGN KEY(account_id,farm_id,identity_id)
 REFERENCES accounts(id,farm_id,identity_id);
CREATE TABLE owner_setup (
 digest text PRIMARY KEY, farm_id uuid NOT NULL UNIQUE REFERENCES farms,
 identity_id uuid NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 FOREIGN KEY(farm_id,identity_id) REFERENCES farm_members
);
CREATE TABLE login_limits (
 scope text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, blocked_until timestamptz NOT NULL
);

-- Least-privilege runtime role. It cannot log in until the owner sets a password privately
-- (Neon console or ALTER ROLE ... LOGIN PASSWORD in a separate, unlogged session).
CREATE ROLE livestock_sync_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA livestock_sync TO livestock_sync_runtime;
-- sync-runtime.sql
GRANT SELECT ON farms, farm_members TO livestock_sync_runtime;
GRANT UPDATE (cursor) ON farms TO livestock_sync_runtime;
GRANT SELECT, INSERT ON devices TO livestock_sync_runtime;
GRANT UPDATE (revoked_at) ON devices TO livestock_sync_runtime;
GRANT SELECT, INSERT ON enrollment TO livestock_sync_runtime;
GRANT UPDATE (used_at) ON enrollment TO livestock_sync_runtime;
GRANT SELECT, INSERT, DELETE, UPDATE (attempts) ON quota TO livestock_sync_runtime;
GRANT SELECT, INSERT ON receipts, changes TO livestock_sync_runtime;
GRANT SELECT, INSERT ON health_events, vaccinations, treatments, veterinary_operations TO livestock_sync_runtime;
GRANT SELECT, INSERT, UPDATE (version,payload) ON species, animal_groups, animals, tasks TO livestock_sync_runtime;
-- auth-schema.sql
GRANT SELECT, INSERT ON accounts TO livestock_sync_runtime;
GRANT UPDATE(password_hash,enabled) ON accounts TO livestock_sync_runtime;
GRANT SELECT ON owner_setup TO livestock_sync_runtime;
GRANT UPDATE(used_at) ON owner_setup TO livestock_sync_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_limits TO livestock_sync_runtime;
GRANT INSERT ON identities, farm_members TO livestock_sync_runtime;
-- reminder-schema.sql: the only changes touching pre-existing (M7B) objects are these grants,
-- issued by the M7B table owner. The temporary membership is revoked before the block ends.
DO $$
DECLARE owner text := current_setting('livestock.m7b_owner'); me text := current_setting('livestock.migration_role');
BEGIN
  IF owner <> me THEN
    EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET TRUE GRANTED BY %I', owner, me, me);
    EXECUTE format('SET LOCAL ROLE %I', owner);
  END IF;
  EXECUTE format('GRANT REFERENCES ON public.livestock_push_devices TO %I', me);
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.livestock_push_devices, public.livestock_push_receipts, public.livestock_push_quota TO livestock_sync_runtime;
  GRANT SELECT,DELETE ON public.livestock_push_grants TO livestock_sync_runtime;
  IF owner <> me THEN
    EXECUTE format('SET LOCAL ROLE %I', me);
    EXECUTE format('REVOKE %I FROM %I GRANTED BY %I', owner, me, me);
  END IF;
  IF current_user <> me OR EXISTS (SELECT 1 FROM pg_auth_members
     WHERE roleid = owner::regrole AND member = me::regrole AND grantor = me::regrole) THEN
    RAISE EXCEPTION 'Temporary M7B membership was not removed';
  END IF;
END $$;
SET LOCAL search_path = livestock_sync, pg_catalog;
CREATE TABLE reminder_devices (
 sync_device_id uuid PRIMARY KEY REFERENCES devices(id),
 push_device_id uuid NOT NULL UNIQUE REFERENCES public.livestock_push_devices(id) ON DELETE CASCADE,
 preferences jsonb NOT NULL
);
GRANT SELECT,INSERT,UPDATE,DELETE ON reminder_devices TO livestock_sync_runtime;

INSERT INTO migrations(version) VALUES ('2026-11-25-m8-production');
COMMIT;
\echo 'M8 schema applied. Next: set the runtime password privately, then bootstrap the farm (docs/RELEASE_CHECKLIST.md).'
