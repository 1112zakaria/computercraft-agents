# Data Model

## 1. Storage choice

PostgreSQL is the default durable store for the VPS control plane.

Structured state SHALL not be collapsed into one vector database. Semantic retrieval MAY use embeddings later, but core entities remain relational/structured.

## 2. Core tables/entities

### agents

```text
id PK
name UNIQUE
backend_type
worker_binding_id nullable
enabled
home_location_id nullable
capability_policy_id
created_at
updated_at
```

### groups

```text
id PK
name UNIQUE
purpose
policy_json
```

### group_members

```text
group_id
agent_id
```

### workers

Represents physical execution devices.

```text
id PK
backend_type = 'computercraft'
transport_type = 'gateway-rednet' | 'direct-http'
gateway_id nullable
minecraft_server_id
computer_id
label
online
boot_id
runtime_version
last_seen_at
capabilities_json
```

Workers using `gateway-rednet` require `gateway_id`; workers using `direct-http` require
`gateway_id IS NULL`. Existing gateway workers are backfilled as `gateway-rednet`. Direct worker
registration, command delivery, event ingestion, and individual update rollouts reuse the durable
delivery/event tables with the transport recorded explicitly.

### worker_observations

Current cached observation plus optional history.

```text
worker_id
observed_at
dimension
x/y/z
facing
position_confidence
fuel_level
inventory_json
current_command_id
status
```

Minecraft/turtle observations remain authoritative for physical state.

### projects

```text
id
name
created_by_principal
status
goal_text
desired_state_json
acceptance_state
created_at
updated_at
```

### jobs

```text
id
project_id
status
priority
assigned_agent_id nullable
required_capabilities_json
dependency_policy
created_at
updated_at
```

### tasks

```text
id
job_id
kind
status
skill_name
arguments_json
resume_state_json
attempt_count
last_error_json
```

### task_dependencies

```text
task_id
depends_on_task_id
```

### standing_policies

```text
id
scope_type
scope_id
condition_json
desired_state_json
priority
enabled
last_evaluated_at
```

### named_locations

```text
id
name UNIQUE
dimension
x/y/z
facing nullable
bounds_json nullable
source
confidence
observed_at
metadata_json
```

### resource_reservations

```text
id
project_id
task_id nullable
item_key
quantity
source_location_id nullable
status
expires_at nullable
```

### conversations

```text
id
thread_key
channel
created_at
```

### messages

```text
id
conversation_id
speaker_type
speaker_id
recipient_scope_json
content
created_at
related_project_id nullable
related_job_id nullable
metadata_json
```

### memories

```text
id
scope_type          # agent/team/world/project/user
scope_id nullable
kind
content_json/text
source
confidence
freshness_policy
created_at
last_validated_at
```

### audit_events

```text
id
occurred_at
category
principal_id nullable
agent_id nullable
project_id nullable
job_id nullable
task_id nullable
worker_id nullable
skill_name nullable
action_json
result_json
retention_class
```

## 3. Agent configuration in Git

Static/declarative data MAY live in Git and be synchronized into DB/config at startup.

Example:

```yaml
agents:
  - id: alice
    display_name: Alice
    backend: computercraft
    groups: [miners]
    default_policy: pragmatic
```

Secrets SHALL not live in these files.

## 4. State ownership rule

Do not dual-own physical state.

Bad:

```text
Postgres inventory says 64 stone
Turtle actually has 12 stone
Planner trusts Postgres
```

Correct:

- PostgreSQL stores observations/history.
- The current turtle/peripheral observation wins before consequential execution.

## 5. Position confidence

Turtle coordinates are dead-reckoned; model confidence explicitly:

```text
CONFIRMED_ANCHOR
DEAD_RECKONED
SUSPECT
UNKNOWN
```

Navigation SHALL refuse or request recalibration when position is too uncertain for a destructive operation.

## 6. Conversation context

Short-lived conversational state SHOULD be separate from permanent semantic memory.

Example session state:

```text
last_explicit_target = alice
last_location_reference = Build Site A
expires_at = ...
```

This enables follow-ups without making every conversation fact permanent agent memory.
