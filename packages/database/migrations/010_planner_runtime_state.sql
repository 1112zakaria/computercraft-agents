CREATE TABLE planner_runtime_state (
  runtime_id TEXT PRIMARY KEY CHECK (runtime_id = 'default'),
  state TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'DEGRADED', 'PAUSED')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_failure_at TIMESTAMPTZ,
  retry_after TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO planner_runtime_state (runtime_id, state)
VALUES ('default', 'AVAILABLE')
ON CONFLICT (runtime_id) DO NOTHING;
