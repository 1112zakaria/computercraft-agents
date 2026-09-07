CREATE SEQUENCE gateway_delivery_cursor_seq;

CREATE TABLE gateway_commands (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_cursor BIGINT NOT NULL DEFAULT nextval('gateway_delivery_cursor_seq') UNIQUE,
  command_id TEXT NOT NULL UNIQUE CHECK (length(trim(command_id)) > 0),
  worker_key TEXT NOT NULL CHECK (length(trim(worker_key)) > 0),
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'DELIVERED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > issued_at)
);

CREATE TABLE gateway_stop_controls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_cursor BIGINT NOT NULL DEFAULT nextval('gateway_delivery_cursor_seq') UNIQUE,
  control_id TEXT NOT NULL UNIQUE CHECK (length(trim(control_id)) > 0),
  worker_key TEXT,
  payload_json JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (worker_key IS NULL OR length(trim(worker_key)) > 0)
);

CREATE TABLE gateway_events (
  event_id TEXT PRIMARY KEY CHECK (length(trim(event_id)) > 0),
  gateway_key TEXT NOT NULL CHECK (length(trim(gateway_key)) > 0),
  boot_id TEXT NOT NULL CHECK (length(trim(boot_id)) > 0),
  worker_key TEXT,
  command_id TEXT,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX gateway_commands_poll_idx ON gateway_commands (status, expires_at, delivery_cursor);
CREATE INDEX gateway_commands_worker_idx ON gateway_commands (worker_key, status, created_at DESC);
CREATE INDEX gateway_stop_controls_poll_idx ON gateway_stop_controls (delivery_cursor);
CREATE INDEX gateway_events_command_idx ON gateway_events (command_id, occurred_at);
CREATE INDEX gateway_events_gateway_sequence_idx ON gateway_events (gateway_key, boot_id, sequence);

CREATE TRIGGER gateway_commands_set_updated_at
BEFORE UPDATE ON gateway_commands
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
