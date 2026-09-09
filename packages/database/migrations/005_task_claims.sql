ALTER TABLE tasks
  ADD COLUMN assigned_worker_id BIGINT REFERENCES workers(id) ON DELETE SET NULL,
  ADD COLUMN claimed_at TIMESTAMPTZ,
  ADD COLUMN started_at TIMESTAMPTZ;

CREATE INDEX tasks_assigned_worker_idx ON tasks (assigned_worker_id, status);

CREATE UNIQUE INDEX tasks_active_worker_idx
  ON tasks (assigned_worker_id)
  WHERE assigned_worker_id IS NOT NULL
    AND status IN ('RUNNING', 'PAUSED');
