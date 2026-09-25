ALTER TABLE gateway_commands
  ADD COLUMN task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX gateway_commands_task_idx
  ON gateway_commands (task_id, status, created_at DESC);

CREATE UNIQUE INDEX gateway_commands_active_task_idx
  ON gateway_commands (task_id)
  WHERE task_id IS NOT NULL
    AND status IN ('QUEUED', 'DELIVERED', 'RUNNING');
