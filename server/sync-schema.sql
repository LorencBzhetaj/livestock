BEGIN;

CREATE SCHEMA livestock_sync;
SET LOCAL search_path = livestock_sync, pg_catalog;

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
COMMIT;
