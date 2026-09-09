ALTER TABLE workers
  ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'gateway-rednet'
    CHECK (transport_type IN ('gateway-rednet', 'direct-http')),
  ADD COLUMN minecraft_server_id TEXT;

UPDATE workers w
SET minecraft_server_id = g.minecraft_server_id
FROM gateways g
WHERE g.id = w.gateway_id
  AND w.minecraft_server_id IS NULL;

ALTER TABLE workers
  ALTER COLUMN gateway_id DROP NOT NULL,
  ALTER COLUMN minecraft_server_id SET NOT NULL;

ALTER TABLE workers
  ADD CONSTRAINT workers_transport_gateway_consistency CHECK (
    (transport_type = 'gateway-rednet' AND gateway_id IS NOT NULL)
    OR (transport_type = 'direct-http' AND gateway_id IS NULL)
  );

CREATE UNIQUE INDEX workers_direct_computer_idx
  ON workers (minecraft_server_id, computer_id)
  WHERE transport_type = 'direct-http';

ALTER TABLE gateway_commands
  ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'gateway-rednet'
    CHECK (transport_type IN ('gateway-rednet', 'direct-http'));

ALTER TABLE gateway_stop_controls
  ADD COLUMN transport_type TEXT
    CHECK (transport_type IS NULL OR transport_type IN ('gateway-rednet', 'direct-http'));

ALTER TABLE gateway_events
  ALTER COLUMN gateway_key DROP NOT NULL,
  ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'gateway-rednet'
    CHECK (transport_type IN ('gateway-rednet', 'direct-http'));

ALTER TABLE update_rollouts
  ALTER COLUMN gateway_key DROP NOT NULL,
  ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'gateway-rednet'
    CHECK (transport_type IN ('gateway-rednet', 'direct-http'));

CREATE INDEX workers_transport_online_idx ON workers (transport_type, online, worker_key);
CREATE INDEX gateway_commands_direct_poll_idx
  ON gateway_commands (transport_type, worker_key, delivery_cursor);
CREATE INDEX gateway_events_worker_time_idx
  ON gateway_events (worker_key, occurred_at DESC);
CREATE INDEX update_rollouts_direct_poll_idx
  ON update_rollouts (transport_type, target_key, delivery_cursor, status, expires_at);

DROP INDEX IF EXISTS update_rollouts_active_gateway_idx;

CREATE UNIQUE INDEX update_rollouts_active_gateway_idx
  ON update_rollouts (gateway_key)
  WHERE transport_type = 'gateway-rednet'
    AND gateway_key IS NOT NULL
    AND status IN ('QUEUED', 'RUNNING', 'CANARY');

CREATE UNIQUE INDEX update_rollouts_active_direct_worker_idx
  ON update_rollouts (target_key)
  WHERE transport_type = 'direct-http'
    AND target_type = 'worker'
    AND status IN ('QUEUED', 'RUNNING', 'CANARY');
