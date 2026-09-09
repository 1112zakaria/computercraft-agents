CREATE TABLE planner_triggers (
  trigger_id TEXT PRIMARY KEY,
  cause TEXT NOT NULL CHECK (cause IN (
    'goal.created',
    'command.completed',
    'command.failed',
    'worker.blocked',
    'delegation.required',
    'replan.required'
  )),
  subject_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  last_error_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX planner_triggers_pending_idx
  ON planner_triggers (status, priority DESC, occurred_at, trigger_id);
