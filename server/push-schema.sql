BEGIN;

CREATE TABLE IF NOT EXISTS livestock_push_devices (
  id uuid PRIMARY KEY,
  principal_id uuid NOT NULL,
  endpoint_hash text NOT NULL UNIQUE,
  sealed_subscription text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS livestock_push_devices_expiry ON livestock_push_devices(expires_at);

CREATE TABLE IF NOT EXISTS livestock_push_grants (
  digest text PRIMARY KEY,
  principal_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  request_id uuid,
  device_id uuid,
  payload_hash text
);
CREATE INDEX IF NOT EXISTS livestock_push_grants_expiry ON livestock_push_grants(expires_at);

CREATE TABLE IF NOT EXISTS livestock_push_quota (
  scope text NOT NULL,
  bucket bigint NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (scope, bucket)
);
CREATE INDEX IF NOT EXISTS livestock_push_quota_bucket ON livestock_push_quota(bucket);

CREATE TABLE IF NOT EXISTS livestock_push_receipts (
  device_id uuid NOT NULL REFERENCES livestock_push_devices(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('sq','en')),
  outcome text NOT NULL CHECK (outcome IN ('serverAccepted','providerAccepted','providerRejected')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, request_id)
);
CREATE INDEX IF NOT EXISTS livestock_push_receipts_created ON livestock_push_receipts(created_at);

COMMIT;
