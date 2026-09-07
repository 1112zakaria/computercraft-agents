CREATE TABLE gateways (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gateway_key TEXT NOT NULL UNIQUE CHECK (length(trim(gateway_key)) > 0),
  boot_id TEXT NOT NULL CHECK (length(trim(boot_id)) > 0),
  minecraft_server_id TEXT NOT NULL CHECK (length(trim(minecraft_server_id)) > 0),
  runtime_version TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'DEGRADED', 'OFFLINE')),
  last_seen_at TIMESTAMPTZ,
  capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_key TEXT NOT NULL UNIQUE CHECK (length(trim(worker_key)) > 0),
  backend_type TEXT NOT NULL DEFAULT 'computercraft' CHECK (length(trim(backend_type)) > 0),
  gateway_id BIGINT NOT NULL REFERENCES gateways(id) ON DELETE RESTRICT,
  computer_id INTEGER NOT NULL CHECK (computer_id >= 0),
  label TEXT,
  online BOOLEAN NOT NULL DEFAULT FALSE,
  boot_id TEXT,
  runtime_version TEXT,
  last_seen_at TIMESTAMPTZ,
  capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, computer_id)
);

CREATE TABLE named_locations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  dimension INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  facing TEXT CHECK (facing IS NULL OR facing IN ('N', 'E', 'S', 'W')),
  bounds_json JSONB,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  confidence TEXT NOT NULL CHECK (confidence IN ('CONFIRMED_ANCHOR', 'DEAD_RECKONED', 'SUSPECT', 'UNKNOWN')),
  observed_at TIMESTAMPTZ NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE agents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  backend_type TEXT NOT NULL DEFAULT 'computercraft' CHECK (length(trim(backend_type)) > 0),
  worker_binding_id BIGINT REFERENCES workers(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  home_location_id BIGINT REFERENCES named_locations(id) ON DELETE SET NULL,
  capability_policy_id TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(capability_policy_id)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
  policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, agent_id)
);

CREATE TABLE worker_observations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_id BIGINT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  dimension INTEGER,
  x INTEGER,
  y INTEGER,
  z INTEGER,
  facing TEXT CHECK (facing IS NULL OR facing IN ('N', 'E', 'S', 'W')),
  position_confidence TEXT CHECK (
    position_confidence IS NULL OR position_confidence IN ('CONFIRMED_ANCHOR', 'DEAD_RECKONED', 'SUSPECT', 'UNKNOWN')
  ),
  fuel_level BIGINT CHECK (fuel_level IS NULL OR fuel_level >= 0),
  inventory_json JSONB,
  current_command_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'STOPPED'))
);

CREATE TABLE projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by_principal TEXT NOT NULL CHECK (length(trim(created_by_principal)) > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED')),
  goal_text TEXT NOT NULL CHECK (length(trim(goal_text)) > 0),
  desired_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  acceptance_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'PAUSED', 'BLOCKED', 'DONE', 'FAILED', 'CANCELLED')),
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  required_capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependency_policy TEXT NOT NULL DEFAULT 'ALL' CHECK (dependency_policy IN ('ALL', 'ANY', 'NONE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'PAUSED', 'BLOCKED', 'DONE', 'FAILED', 'CANCELLED')),
  skill_name TEXT NOT NULL CHECK (length(trim(skill_name)) > 0),
  arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_json JSONB
);

CREATE TABLE task_dependencies (
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE standing_policies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('AGENT', 'GROUP', 'PROJECT', 'WORLD', 'USER')),
  scope_id TEXT,
  condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  desired_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_evaluated_at TIMESTAMPTZ
);

CREATE TABLE resource_reservations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  item_key TEXT NOT NULL CHECK (length(trim(item_key)) > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_location_id BIGINT REFERENCES named_locations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'FULFILLED', 'EXPIRED')),
  expires_at TIMESTAMPTZ
);

CREATE TABLE conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_key TEXT NOT NULL UNIQUE CHECK (length(trim(thread_key)) > 0),
  channel TEXT NOT NULL CHECK (length(trim(channel)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  speaker_type TEXT NOT NULL CHECK (speaker_type IN ('USER', 'AGENT', 'SYSTEM', 'GATEWAY', 'WORKER')),
  speaker_id TEXT,
  recipient_scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  related_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  related_job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE memories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('AGENT', 'TEAM', 'WORLD', 'PROJECT', 'USER')),
  scope_id TEXT,
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  content_json JSONB,
  content_text TEXT,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  freshness_policy TEXT NOT NULL CHECK (length(trim(freshness_policy)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ,
  CHECK (content_json IS NOT NULL OR content_text IS NOT NULL)
);

CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL CHECK (length(trim(category)) > 0),
  principal_id TEXT,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  worker_id BIGINT REFERENCES workers(id) ON DELETE SET NULL,
  skill_name TEXT,
  action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_class TEXT NOT NULL DEFAULT 'STANDARD' CHECK (retention_class IN ('STANDARD', 'HIGH', 'IMMUTABLE'))
);

CREATE INDEX workers_gateway_online_idx ON workers (gateway_id, online);
CREATE INDEX worker_observations_worker_time_idx ON worker_observations (worker_id, observed_at DESC);
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX jobs_project_status_priority_idx ON jobs (project_id, status, priority DESC);
CREATE INDEX tasks_job_status_idx ON tasks (job_id, status);
CREATE INDEX task_dependencies_dependency_idx ON task_dependencies (depends_on_task_id);
CREATE INDEX standing_policies_scope_idx ON standing_policies (scope_type, scope_id, enabled, priority DESC);
CREATE INDEX resource_reservations_project_status_idx ON resource_reservations (project_id, status);
CREATE INDEX messages_conversation_time_idx ON messages (conversation_id, created_at);
CREATE INDEX memories_scope_idx ON memories (scope_type, scope_id);
CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_lineage_idx ON audit_events (project_id, job_id, task_id, worker_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER gateways_set_updated_at
BEFORE UPDATE ON gateways
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER workers_set_updated_at
BEFORE UPDATE ON workers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agents_set_updated_at
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER groups_set_updated_at
BEFORE UPDATE ON groups
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER projects_set_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER jobs_set_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
