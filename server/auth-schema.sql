BEGIN;
CREATE TABLE livestock_sync.accounts (
 id uuid PRIMARY KEY, farm_id uuid NOT NULL, identity_id uuid NOT NULL,
 username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,40}$'),
 role text NOT NULL CHECK (role IN ('ADMIN','VETERINARIAN')), password_hash text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 UNIQUE(farm_id,role), UNIQUE(id,farm_id,identity_id),
 FOREIGN KEY(farm_id,identity_id) REFERENCES livestock_sync.farm_members
);
ALTER TABLE livestock_sync.devices ADD COLUMN account_id uuid;
ALTER TABLE livestock_sync.devices ADD COLUMN expires_at timestamptz;
ALTER TABLE livestock_sync.devices ADD CONSTRAINT device_account FOREIGN KEY(account_id,farm_id,identity_id)
 REFERENCES livestock_sync.accounts(id,farm_id,identity_id);
CREATE TABLE livestock_sync.owner_setup (
 digest text PRIMARY KEY, farm_id uuid NOT NULL UNIQUE REFERENCES livestock_sync.farms,
 identity_id uuid NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 FOREIGN KEY(farm_id,identity_id) REFERENCES livestock_sync.farm_members
);
CREATE TABLE livestock_sync.login_limits (
 scope text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, blocked_until timestamptz NOT NULL
);
GRANT SELECT, INSERT ON livestock_sync.accounts TO livestock_sync_runtime;
GRANT UPDATE(password_hash,enabled) ON livestock_sync.accounts TO livestock_sync_runtime;
GRANT SELECT ON livestock_sync.owner_setup TO livestock_sync_runtime;
GRANT UPDATE(used_at) ON livestock_sync.owner_setup TO livestock_sync_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON livestock_sync.login_limits TO livestock_sync_runtime;
GRANT INSERT ON livestock_sync.identities,livestock_sync.farm_members TO livestock_sync_runtime;
COMMIT;
