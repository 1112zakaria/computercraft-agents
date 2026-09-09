# Observability and Audit

## 1. Goals

The operator should be able to answer:

- What is each worker doing?
- Why is it doing that?
- Which user goal caused the action?
- What is blocked?
- What did Codex decide?
- What physical action failed?
- Is the gateway/turtle reachable?
- What resources were consumed or moved?

## 2. Event lineage

```text
User message
  ↓
Resolved command
  ↓
Project
  ↓
Job
  ↓
Task
  ↓
Planner decision
  ↓
Skill invocation
  ↓
Gateway command
  ↓
Turtle primitives
  ↓
Result/event
  ↓
Verification
```

Identifiers SHOULD be carried across layers where practical.

## 3. Retention classes

### Permanent/high-retention

- user commands;
- conversation messages;
- project creation/completion/failure;
- planner decisions/summaries;
- assignments/delegation;
- refusals and overrides;
- standing-policy changes;
- significant resource consumption decisions;
- mod configuration;
- DefenseTech arm/fire actions;
- administrative controls.

### Bounded retention

- individual turtle moves;
- block digs/placements;
- inventory transfers;
- path progress;
- high-frequency observations.

### Debug/configurable

- raw HTTP payloads;
- Rednet frames;
- pathfinder internal expansion;
- verbose model/tool traces.

## 4. CLI status views

Minimum commands should eventually support:

```text
agents list
agent alice status
agent alice plan
agent alice inventory
workers list
gateways status
projects list
project <id> inspect
jobs list --agent alice
logs tail --agent alice
conversation show <thread>
stop alice
stop all
resume alice
```

The worker inventory view is populated by the latest `inventory.changed` event and by the result
of a bounded `inventory.inspect` command. An operator can refresh the persisted snapshot with
`npm run cli -- inspect <worker-id>` and then inspect the worker without a direct database query.

## 5. Metrics

Useful counters/gauges:

- gateway online;
- workers online;
- active/queued/blocked tasks;
- command latency;
- command failure rate;
- Codex requests by tier;
- Codex failure/timeout rate;
- turtle primitive count;
- block changes;
- path replans;
- resource deliveries;
- event backlog size.

Prometheus is optional; structured logs + database status are sufficient initially.

## 6. Control-plane structured logs

The control plane writes one JSON record per lifecycle/request event. HTTP records include:
`requestId`, method, path, status code, and duration. Command/task/update/worker lineage fields
are available to callers that emit those events, and scheduler/recovery failures include an
explicit `outcome` and error message. The `X-Request-Id` response header exposes the correlation
ID for support diagnostics; a safe caller-supplied ID is preserved, otherwise one is generated.

Request bodies, bearer credentials, authorization headers, and secret-like fields are never logged.
Secret-like keys are redacted defensively if they are passed to the logger in future code.

Recent persisted audit records can be inspected without direct database access:

```bash
npm run cli -- audit
npm run cli -- audit 100
```

This is an operator-only view and includes category, worker, lineage, retention, action, and
result fields for the bounded result set.

Audit cleanup runs on the control plane using these defaults:

- STANDARD: 30 days;
- HIGH: 365 days;
- IMMUTABLE: never deleted.

The windows and cleanup interval can be changed with `AUDIT_STANDARD_RETENTION_DAYS`,
`AUDIT_HIGH_RETENTION_DAYS`, and `RETENTION_CLEANUP_INTERVAL_SECONDS`. Cleanup reports only
counts and never logs audit payloads.
