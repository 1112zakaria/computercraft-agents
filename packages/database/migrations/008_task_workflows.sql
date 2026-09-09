ALTER TABLE tasks
  ADD COLUMN parent_task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN workflow_phase TEXT;

CREATE INDEX tasks_parent_workflow_idx
  ON tasks (parent_task_id, status, workflow_phase);
