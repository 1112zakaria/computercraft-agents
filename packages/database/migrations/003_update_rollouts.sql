CREATE TABLE update_rollouts (
  update_id TEXT PRIMARY KEY CHECK (length(trim(update_id)) > 0),
  target TEXT NOT NULL CHECK (length(trim(target)) > 0),
  target_type TEXT NOT NULL CHECK (target_type IN ('gateway', 'worker', 'fleet')),
  target_key TEXT NOT NULL CHECK (length(trim(target_key)) > 0),
  gateway_key TEXT NOT NULL REFERENCES gateways(gateway_key) ON DELETE RESTRICT,
  release_version TEXT NOT NULL CHECK (release_version ~ '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$'),
  manifest_url TEXT NOT NULL CHECK (manifest_url ~ '^https://'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  delivery_cursor BIGINT NOT NULL DEFAULT nextval('gateway_delivery_cursor_seq') UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'CANARY', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK', 'CANCELLED')),
  failure_code TEXT,
  failure_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > issued_at)
);

CREATE TABLE update_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  update_id TEXT NOT NULL REFERENCES update_rollouts(update_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'CANARY', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK', 'CANCELLED')),
  message TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX update_rollouts_active_gateway_idx
  ON update_rollouts (gateway_key)
  WHERE status IN ('QUEUED', 'RUNNING', 'CANARY');
CREATE INDEX update_rollouts_poll_idx
  ON update_rollouts (gateway_key, delivery_cursor, status, expires_at);
CREATE INDEX update_rollouts_target_idx
  ON update_rollouts (target_type, target_key, created_at DESC);
CREATE INDEX update_events_update_idx
  ON update_events (update_id, created_at DESC, id DESC);

CREATE TRIGGER update_rollouts_set_updated_at
BEFORE UPDATE ON update_rollouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
