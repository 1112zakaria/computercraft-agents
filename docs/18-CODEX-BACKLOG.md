# Codex Implementation Backlog

This backlog is written for a coding agent working incrementally in the repository. Items are ordered to reduce risk. Codex SHOULD complete one bounded item at a time, run relevant tests, update documentation when contracts change, and avoid starting later destructive features before prerequisites pass.

## Current implementation notes

As of 2026-09-09, the direct HTTP transport has passed a live canary on worker `alice`, including
registration, heartbeat, bounded movement, event submission, and a successful `v0.4.1` OTA
activation/reboot. The installer and stable bootstrap now create or repair the extensionless
CraftOS `startup` hook; live post-reboot validation of that behavior remains tracked in GitHub
issue #7.

Gateway Rednet live validation remains pending because the gateway/turtle modem hardware is not
available. It is not a blocker for the direct HTTP primary path.

The navigation, scheduler, and excavation implementations currently include tested deterministic
foundations only; they are not yet the complete persistent task/resource workflow.

Priority:

- **P0** — required for first useful system.
- **P1** — required for intended v1 feature set.
- **P2** — valuable later capability.

Status at project start: all items **TODO** unless explicitly marked otherwise.

---

## Epic A — Repository and development foundation

### CC-001 — Bootstrap monorepo

**Priority:** P0  
**Dependencies:** none
**Status:** DONE

Create the baseline repository layout described in `11-DEPLOYMENT.md`.

**Deliverables**

- TypeScript workspace for control plane/packages;
- `computercraft/gateway` and `computercraft/turtle` directories;
- test directories;
- lint/format/typecheck scripts;
- `.env.example` and configuration templates;
- root README linking specifications.

**Acceptance criteria**

- fresh clone installs dependencies successfully;
- `npm test`/equivalent runs;
- TypeScript build/typecheck passes;
- no secrets are committed.

### CC-002 — Add CI baseline

**Priority:** P0  
**Dependencies:** CC-001
**Status:** DONE

Add GitHub Actions for TypeScript lint/typecheck/tests and basic Lua static/test checks chosen by the repo.

**Acceptance criteria**

- CI runs on pull requests;
- intentionally broken TypeScript test fails CI;
- Lua syntax/test failures are detected.

### CC-003 — Define shared configuration loader

**Priority:** P0  
**Dependencies:** CC-001
**Status:** DONE

Implement validated configuration for database, HTTP binding, gateway auth, Codex settings, reasoning concurrency, feature gates, and log level.

**Acceptance criteria**

- invalid/missing required config produces clear startup errors;
- secrets can be supplied via environment variables;
- non-secret defaults can be checked into Git.

---

## Epic B — Protocol and VPS gateway service

### CC-010 — Define protocol schemas v1

**Priority:** P0  
**Dependencies:** CC-001
**Status:** DONE

Create typed schemas for gateway registration, heartbeat, commands, events, errors, workers, capabilities, and stop controls.

**Acceptance criteria**

- all external payloads validate at runtime;
- protocol version is mandatory;
- invalid skill/argument payloads are rejected;
- schema fixtures cover success/failure examples.

### CC-011 — Implement gateway authentication middleware

**Priority:** P0  
**Dependencies:** CC-003, CC-010
**Status:** DONE

Implement gateway ID + bearer secret authentication.

**Acceptance criteria**

- valid gateway can register;
- missing/incorrect token receives unauthorized result;
- secrets are never logged.

### CC-012 — Implement gateway registration/heartbeat endpoints

**Priority:** P0  
**Dependencies:** CC-010, CC-011
**Status:** DONE

**Acceptance criteria**

- gateway registration creates/updates gateway session;
- workers reported by gateway are visible in application state;
- missed heartbeat transitions gateway/workers to offline after configured threshold.

### CC-013 — Implement command queue/poll endpoint

**Priority:** P0  
**Dependencies:** CC-010, CC-012
**Status:** DONE

Support worker-targeted commands and polling/long-polling with cursor semantics.

**Acceptance criteria**

- command is returned once per delivery attempt;
- retry does not create a new command ID;
- cancelled/expired commands are not newly delivered;
- long-poll can time out cleanly.

### CC-014 — Implement event ingestion and deduplication

**Priority:** P0  
**Dependencies:** CC-010, CC-012
**Status:** DONE

**Acceptance criteria**

- event batches ingest successfully;
- duplicate `eventId` is harmless;
- per-session sequences are stored/validated where useful;
- command completion updates current execution state.

### CC-015 — Implement urgent stop control path

**Priority:** P0  
**Dependencies:** CC-013
**Status:** DONE

Ensure stop controls are not hidden behind ordinary queued work.

**Acceptance criteria**

- `stop worker` becomes visible to gateway immediately/next poll;
- global stop can target all known workers;
- no Codex dependency.

---

## Epic C — Database and domain model

### CC-020 — Add PostgreSQL migrations/core tables

**Priority:** P0  
**Dependencies:** CC-001
**Status:** DONE

Implement agents, workers, gateways, projects, jobs, tasks, dependencies, conversations/messages, named locations, audit events.

**Acceptance criteria**

- migrations apply to empty DB;
- migrations can be run in CI/test DB;
- relationships/constraints match `06-DATA-MODEL.md`.

### CC-021 — Implement agent/group registry

**Priority:** P0  
**Dependencies:** CC-020
**Status:** DONE

**Acceptance criteria**

- create/read/update/disable logical agents;
- create persistent groups with purpose;
- group membership changes do not affect worker runtime installation.

### CC-022 — Implement worker registry/binding

**Priority:** P0  
**Dependencies:** CC-012, CC-020, CC-021
**Status:** DONE

**Acceptance criteria**

- ComputerCraft computer ID/session can bind to a logical worker;
- logical agent can be mapped to worker binding;
- offline worker remains represented but not runnable.

### CC-023 — Implement project/job/task repositories

**Priority:** P0  
**Dependencies:** CC-020
**Status:** PARTIAL — project/job/task creation, goal persistence, task inspection (including
single-task detail), a read-only goal workflow report, restart-safe database claims, explicit
command-task dispatch, and the first bounded multi-step workflow are implemented; workflow event
advancement is duplicate/late-event safe, while broader dependency and recovery semantics remain.

Implement state transitions and task dependencies.

**Acceptance criteria**

- invalid transitions rejected;
- persisted job survives service restart;
- runnable tasks query excludes unmet dependencies.

### CC-024 — Implement audit event service

**Priority:** P0  
**Dependencies:** CC-020
**Status:** DONE

**Acceptance criteria**

- material application actions can emit linked audit events;
- retention class is stored;
- lineage IDs may reference project/job/task/worker.

---

## Epic D — ComputerCraft gateway Lua runtime

### CC-030 — Gateway bootstrap/config

**Priority:** P0  
**Dependencies:** CC-010
**Status:** DONE

Implement `startup.lua`, validated local config, logging, and gateway identity.

**Acceptance criteria**

- gateway starts automatically;
- missing VPS URL/secret yields actionable error;
- config does not print secret.

### CC-031 — Gateway HTTP registration and heartbeat

**Priority:** P0  
**Dependencies:** CC-012, CC-030
**Status:** DONE

**Acceptance criteria**

- real ComputerCraft computer registers with local/test VPS endpoint;
- periodic heartbeat is visible;
- retry/backoff handles temporary HTTP failure.

### CC-032 — Gateway Rednet worker discovery

**Priority:** P0  
**Dependencies:** CC-030
**Status:** DONE

Define worker registration handshake over Rednet.

**Acceptance criteria**

- multiple fake/real turtles can register;
- gateway maps worker ID ↔ ComputerCraft sender ID;
- duplicate/invalid registrations handled safely.

### CC-033 — Gateway command dispatcher

**Priority:** P0  
**Dependencies:** CC-013, CC-031, CC-032
**Status:** DONE

Poll VPS commands and dispatch to target turtle.

**Acceptance criteria**

- request/response correlation works;
- missing worker yields explicit error event;
- no command is broadcast accidentally to all turtles unless explicitly global.

### CC-034 — Gateway outbox/event batching

**Priority:** P0  
**Dependencies:** CC-014, CC-031
**Status:** DONE

**Acceptance criteria**

- worker events are buffered and batched;
- retry after HTTP failure does not lose events;
- bounded queue prevents unbounded disk/memory growth;
- acknowledgements/deduplication are respected.

### CC-035 — Gateway urgent stop routing

**Priority:** P0  
**Dependencies:** CC-015, CC-033
**Status:** DONE

**Acceptance criteria**

- stop reaches executing turtle on next control check;
- global stop routes to all registered workers.

---

## Epic E — Turtle runtime foundation

### CC-040 — Turtle registration and heartbeat

**Priority:** P0  
**Dependencies:** CC-032
**Status:** DONE

**Acceptance criteria**

- turtle identifies stable worker ID/computer ID/runtime version;
- heartbeat/state is relayed through gateway;
- reboot creates a new boot/session ID.

### CC-041 — Turtle state/orientation module

**Priority:** P0  
**Dependencies:** CC-040
**Status:** DONE

Implement local `(x,y,z,facing,dimension,confidence)` state and atomic updates.

**Acceptance criteria**

- turns/moves update state correctly;
- state persists across turtle reboot where appropriate;
- manual `mark_position_uncertain` path exists.

### CC-042 — Normalize movement primitives

**Priority:** P0  
**Dependencies:** CC-041
**Status:** DONE

Wrap forward/back/up/down/turn operations into typed result objects/events.

**Acceptance criteria**

- blocked/no-fuel/errors are distinguishable;
- successful moves update coordinates exactly once;
- primitive is unit-testable with mocked turtle API.

### CC-043 — Implement cancellation and budgets

**Priority:** P0  
**Dependencies:** CC-040
**Status:** DONE

**Acceptance criteria**

- long command checks stop/cancel between primitives;
- max primitive/block-change budget enforced;
- budget exhaustion is reported cleanly.

### CC-044 — Implement inspect/dig/place wrappers

**Priority:** P0  
**Dependencies:** CC-043
**Status:** DONE

**Acceptance criteria**

- front/up/down variants supported;
- observations include block identity/data available from API;
- dig/place action results are explicit;
- block-change budget is decremented correctly.

### CC-045 — Implement inventory snapshot/transfer helpers

**Priority:** P0  
**Dependencies:** CC-040
**Status:** DONE

**Acceptance criteria**

- all 16 slots can be summarized;
- count/find/select helpers deterministic;
- suck/drop result verified as much as API allows;
- reserved slot configuration supported.

### CC-046 — Implement fuel module

**Priority:** P0  
**Dependencies:** CC-045
**Status:** DONE

**Acceptance criteria**

- detects unlimited vs limited fuel if API allows;
- reports low/empty fuel;
- bounded refuel skill consumes configured acceptable fuel items.

### CC-047 — Implement command idempotency cache

**Priority:** P0  
**Dependencies:** CC-040
**Status:** DONE

**Acceptance criteria**

- replayed completed command does not mutate world twice;
- recent completed command result can be re-reported;
- cache is bounded.

---

## Epic F — First end-to-end deterministic control

### CC-050 — CLI worker inspection

**Priority:** P0  
**Dependencies:** CC-022, CC-040
**Status:** DONE — list and single-worker inspection are available through the protected API and
CLI; fake Rednet coverage exercises the worker message path.

Add CLI commands to list workers and inspect status/state.

### CC-051 — CLI deterministic movement command

**Priority:** P0  
**Dependencies:** CC-033, CC-042, CC-050
**Status:** PARTIAL — bounded move and stop commands are implemented and fake-integrated, and the
direct-HTTP movement canary has been validated on the live modem-less turtle. The gateway-Rednet
live acceptance remains blocked until gateway ID 4 and the turtle have modems attached.

Before Codex, prove `worker move/turn` command path end-to-end.

**Acceptance criteria**

- CLI → VPS → gateway → turtle → result works on live server;
- audit/event lineage recorded;
- stop works.

### CC-052 — Milestone-zero connectivity diagnostic

**Priority:** P0  
**Dependencies:** CC-031, CC-051, CC-053

**Status:** PARTIAL — public HTTPS, authenticated connectivity, source allowlist admission, and
worker/gateway inspection are available; `diagnose` now provides a single bounded summary of
registration, liveness, transports, and runtime versions, and gateway/direct HTTP clients preserve
the native ComputerCraft connection error returned by `http.get`/`http.post`. Live gateway-path
registration and command acceptance remain pending modem hardware.

Implement a diagnostic command/output showing public HTTPS reachability, observed gateway source
address/allowlist admission, gateway status, worker status, runtime/protocol versions.

### CC-053 — Public HTTPS gateway ingress and source allowlist

**Priority:** P0
**Dependencies:** CC-011, CC-031
**Status:** DONE — public and authenticated HTTPS connectivity canaries verified from the
friend's Minecraft host on 2026-09-08.

Replace the WireGuard-only gateway route with a public TLS reverse proxy that forwards only
`/v1/gateway/*` to the loopback-bound control plane. Enforce the firewall and reverse-proxy
source allowlist for the friend's verified Minecraft-host egress address, initially
`51.161.113.44/32`.

**Acceptance criteria**

- control plane binds only to a non-public listener in production;
- public ingress accepts HTTPS only and has a publicly trusted certificate;
- TCP 8787 is not publicly reachable;
- public ingress forwards only `/v1/gateway/*` and rejects other paths;
- firewall and reverse-proxy rules reject a non-allowlisted source;
- a gateway request from `51.161.113.44` succeeds with valid bearer authentication;
- no bearer secret, certificate private key, or operator secret is committed or logged.

---

## Epic J — Gateway-managed runtime updates

### CC-090 — Gateway-managed turtle and gateway updates

**Priority:** P1
**Dependencies:** CC-050, CC-053, CC-010, CC-020
**Status:** IMPLEMENTED on `feat/gateway-managed-updates`; live modem canary pending

Publish immutable GitHub release manifests and deliver allowlisted runtime files through the
gateway's authenticated HTTPS poll and Rednet transfer path. The VPS CLI supports gateway,
worker, and fleet targets. Stable bootstrap/journal files preserve configuration and state and
attempt rollback after interrupted activation.

**Remaining live acceptance**

- install stable updater files on the gateway and turtle;
- queue one worker canary after both modems are available;
- verify new runtime heartbeat and `update-status` success;
- interrupt a fake/live-safe activation and verify rollback.

### CC-091 — Direct turtle HTTP transport

**Priority:** P0
**Dependencies:** CC-010, CC-020, CC-050, CC-053
**Status:** LIVE CANARY COMPLETE on `main`/`v0.4.1`; automatic startup-hook creation/repair is
implemented and tested, while live post-reboot validation remains open as issue #7

Add `direct-http` as a transport-aware alternative to `gateway-rednet`. Direct turtles register,
heartbeat, poll commands/stop controls/updates, and submit durable event batches through the
authenticated `/v1/worker/*` API. Direct workers have no gateway association, do not need a modem,
and download immutable release files directly from GitHub for individual OTA updates. Existing
gateway-backed workers and fleet rollouts remain unchanged.

**Remaining live acceptance**

- provision one direct worker;
- install the direct runtime and `worker.conf` on a modem-less turtle;
- verify registration, heartbeat, bounded movement, stop, and event ingestion;
- queue an individual update and verify activation/rollback without overwriting local state.

**Future hardening**

- per-worker credentials and rotation;
- direct-worker fleet rollout/canary promotion;
- release signatures and per-file hashes;
- optional direct/gateway fallback and offline command mode.

---

## Epic G — Navigation and world map

### CC-060 — Implement sparse world-cell model

**Priority:** P0  
**Dependencies:** CC-020, CC-044

**Status:** PARTIAL — bounded in-memory sparse walkability model, persistent `world_cells` storage,
worker-position anchoring, heartbeat/anchor/named-location walkable-cell seeding, and block-observation
event ingestion plus bounded blocked-destination contradiction updates and gather-route replanning
now exist; planner loading uses a configurable freshness window with a one-day default, while
broader reconciliation remains.

Represent observed cells and freshness/worker source.

### CC-061 — Implement A* pathfinding over known cells

**Priority:** P0  
**Dependencies:** CC-060

**Status:** PARTIAL — bounded known-cell A* planning is exposed through a protected worker-to-
named-location route-plan API and CLI; runtime path execution/replanning remains.

**Acceptance criteria**

- finds paths in fixture maps;
- honors blocked cells;
- stable deterministic output;
- supports vertical movement.

### CC-062 — Implement path execution skill

**Priority:** P0  
**Dependencies:** CC-042, CC-043, CC-061

**Status:** PARTIAL — the turtle executor already performs bounded `navigate.path` execution with
per-step cancellation and blocked-step reporting, and the operator CLI now exposes bounded `path`,
read-only `path-to`, and queued `go-to` commands. Gather navigation can replan up to three times
after a blocked step; loading persistent paths and general-purpose replanning remain.

**Acceptance criteria**

- turtle follows path;
- blocked step reports observation;
- cancellation checked every step;
- no infinite retry.

### CC-063 — Implement frontier exploration/replan

**Priority:** P1  
**Dependencies:** CC-060, CC-062

**Status:** PARTIAL — bounded gather-route replanning after a newly observed blocked cell exists;
frontier exploration through unknown cells and general-purpose replan policy remain.

**Acceptance criteria**

- can advance through partially unknown corridor/world within budget;
- new observations update map;
- path replans after contradiction.

### CC-064 — Named location service

**Priority:** P0  
**Dependencies:** CC-020

**Status:** PARTIAL — named locations can be created, listed, and case-insensitively resolved
through the protected API and CLI (`set-location` records an operator-confirmed anchor), and an
optional approach/docking coordinate now drives route planning and destination-aware gather
workflow targets; full route execution and postcondition verification remain.

**Acceptance criteria**

- create/list/resolve named locations;
- support approach/docking coordinate;
- planner tools can reference by name.

### CC-065 — Position anchor/recalibration spike

**Priority:** P0  
**Dependencies:** CC-041

**Status:** DONE — a protected operator anchor endpoint and CLI command persist a
`CONFIRMED_ANCHOR` observation; facing remains optional and is not treated as automatically
detected.

Evaluate GPS/manual docking/other available approaches and implement the simplest reliable anchor mechanism.

**Acceptance criteria**

- document chosen method;
- position confidence can return to confirmed after known re-anchor.

---

## Epic H — Scheduler

### CC-070 — Implement runnable-task selection

**Priority:** P0  
**Dependencies:** CC-023, CC-022

**Status:** PARTIAL — deterministic capability-aware and target-aware selection, dependency-filtered runnable-task
inspection, an atomic explicit command-task dispatch path, a bounded operator scheduler tick with
explicit skip reasons, and an opt-in non-overlapping background scheduler loop are implemented;
multi-step workflow dispatch remains.

Select tasks based on dependencies, worker availability, required capabilities, and priority.

### CC-071 — Enforce one execution stream per worker

**Priority:** P0  
**Dependencies:** CC-070

**Status:** PARTIAL — scheduler selection reserves each worker once per decision and the database
dispatch path enforces one active command-task per worker; the operator tick and opt-in background
loop exercise this path, while multi-step workflow ownership remains.

**Acceptance criteria**

- concurrent scheduler ticks cannot dispatch two commands/tasks to same worker;
- database/locking strategy tested.

### CC-072 — Implement pause/resume/cancel

**Priority:** P0  
**Dependencies:** CC-015, CC-023, CC-071

**Status:** PARTIAL — the control plane now exposes validated explicit task transitions plus
`pause-task`, `resume-task`, and `cancel-task` CLI controls. Pausing/cancelling a running task now
atomically cancels active command delivery, releases the worker claim, and queues a transport-aware
stop control; resuming returns the task to `READY` and resource reservations remain.

**Acceptance criteria**

- stop maps current work to PAUSED;
- resume continues/replans safely;
- cancel releases eligible resources and never auto-resumes.

### CC-073 — Implement delegation requests

**Priority:** P1  
**Dependencies:** CC-070

Planner-created delegation request becomes scheduler-owned job/task.

### CC-074 — Implement resource reservations

**Priority:** P1  
**Dependencies:** CC-023

Prevent obvious double allocation of shared quantities between concurrent projects.

### CC-075 — Implement standing-policy evaluator

**Priority:** P1  
**Dependencies:** CC-070

Condition → desired state → finite work generation.

---

## Epic I — Codex reasoning

### CC-080 — Define `ReasoningProvider` interface

**Priority:** P0  
**Dependencies:** CC-001

**Status:** DONE — the provider contract carries request identity, reasoning tier, timeout,
cancellation, validated decision output, and timing metadata; the production CLI boundary is
implemented and is used by the opt-in plan-only planner loop.

Support request context, structured schema, timeout, cancellation, reasoning tier, and result metadata.

### CC-081 — Implement fake reasoning provider

**Priority:** P0  
**Dependencies:** CC-080

**Status:** DONE — deterministic queued responses are validated through the planner decision
schema and covered by workspace tests.

Use in tests/CI without live Codex.

### CC-082 — Implement Codex CLI provider

**Priority:** P0  
**Dependencies:** CC-003, CC-080

**Status:** DONE — read-only ephemeral `codex exec` invocation, strict decision validation,
deadline/cancellation handling, sanitized child environment, and injectable test execution are
implemented. Production enablement remains separate.

**Acceptance criteria**

- invokes Codex CLI safely;
- validates structured output;
- timeout/cancellation handled;
- stdout/stderr captured without leaking secrets;
- provider metadata recorded.

### CC-083 — Reasoning tier configuration

**Priority:** P1  
**Dependencies:** CC-082

**Status:** DONE — `fast`, `standard`, and `strong` are selectable logical tiers, and each tier
can optionally map to a deployment-provided Codex model/profile through environment variables.
Blank overrides preserve the Codex CLI default.

Implement `fast`, `standard`, `strong` logical tiers mapped by configuration.

### CC-084 — Reasoning concurrency limiter

**Priority:** P0  
**Dependencies:** CC-082

**Status:** DONE — provider calls are bounded by a configurable concurrency limit and queued
requests can be cancelled before execution.

**Acceptance criteria**

- configurable max concurrent calls;
- queued calls are cancelable;
- scheduler continues deterministic work independently.

### CC-085 — Agent planner structured decision schema

**Priority:** P0  
**Dependencies:** CC-080, CC-023

**Status:** PARTIAL — plan/create-task/continue/delegate/replan/refuse/report decisions are
validated in the reasoning package, planner decisions are durably recorded in HIGH-retention audit
events, and a separately gated safe apply boundary can persist protocol-validated `plan` and
`create-task` proposals idempotently within the subject job/worker scope. Continue/delegate/replan
application and richer policy remain.

Define decisions for plan/create-task/delegate/report/refuse/replan.

### CC-086 — Context assembler

**Priority:** P0  
**Dependencies:** CC-064, CC-085

**Status:** PARTIAL — a bounded, untrusted-data-aware prompt assembler is implemented for goal,
task, worker, skill, world, memory, and conversation context, and the protected planning-context
endpoint now loads task/worker/world records; persistence-backed memory/conversation retrieval and
relevance selection remain.

Assemble goal, current job/task, relevant worker observation, skills, world knowledge, memories, recent conversation.

### CC-087 — Event-driven planner trigger service

**Priority:** P0  
**Dependencies:** CC-085, CC-086

**Status:** PARTIAL — the reasoning package now validates the supported trigger causes, assembles
bounded context, invokes the configured provider, and suppresses duplicate trigger IDs. The
control plane persists idempotent `goal.created`, task-correlated command completion/failure, and
`worker.blocked` triggers, exposes bounded operator inspection, and has an opt-in planner loop that
records validated decisions as HIGH-retention audit events. A separate apply gate can persist only
validated `plan`/`create-task` proposals within the subject job and worker scope, with trigger/index
idempotency and sequential dependencies. Continue/delegate/replan application and broader planner
policy remain. The repository provides a transactional claim/complete boundary with stale-claim
recovery, and the runner releases provider failures for retry.

Trigger on new goal, meaningful completion/failure, unexpected state, delegation need, replan.

### CC-088 — Shared project planner escalation

**Priority:** P1  
**Dependencies:** CC-087

Implement complexity heuristic and structured project plan output.

### CC-089 — Reasoning outage state machine

**Priority:** P0  
**Dependencies:** CC-082, CC-087

**Status:** PARTIAL — the reasoning package now provides an explicit available/degraded/paused
state machine with bounded retry timing and recovery reset. The control plane persists the outage
snapshot, restores it during startup, automatically retries durable pending triggers after the
pause window, and exposes protected `planner-status` inspection. Richer outage policy remains.

**Acceptance criteria**

- provider failure pauses goal-level reasoning;
- deterministic bounded action can finish;
- automatic reconcile/resume on recovery.

---

## Epic J — Natural-language command system

### CC-096 — Implement deterministic address parser

**Priority:** P0  
**Dependencies:** CC-021

**Status:** PARTIAL — explicit syntax for one or more named targets and `@all` is parsed before
reasoning, with duplicate and mixed-`@all` targets rejected. Registry-backed distinction between
worker names and group names, scope expansion, and authorization remain.

Parse agents/groups/`@all` before reasoning.

### CC-097 — Implement CLI natural-language command

**Priority:** P0  
**Dependencies:** CC-085, CC-096

**Status:** PARTIAL — the first narrow gather sentence is parsed and persisted through the
protected `/v1/goals` API and CLI; the explicit CLI `--start` path can perform one bounded
scheduler tick after creation, while full autonomous planner/scheduler dispatch remains.

Example:

```text
agents say '@alice go to Main Workshop'
```

creates goal and starts planner/scheduler flow.

### CC-092 — Implement conversational session context

**Priority:** P1  
**Dependencies:** CC-096, CC-020

Support follow-up targeting without explicit address when context is clear.

### CC-093 — Implement conversation persistence/query CLI

**Priority:** P1  
**Dependencies:** CC-020

### CC-094 — Minecraft chat integration spike

**Priority:** P1  
**Dependencies:** CC-097

Discover existing peripheral support; otherwise specify the smallest Forge chat relay.

### CC-095 — Implement Minecraft chat input/output

**Priority:** P1  
**Dependencies:** CC-094

**Acceptance criteria**

- authorized player message can create same command as CLI;
- agent reply appears in game;
- unauthorized player controlling command is rejected;
- player context is attached when available.

---

## Epic K — Resource gathering and logistics

### CC-100 — Define item/resource key normalization

**Priority:** P0  
**Dependencies:** CC-045

**Status:** PARTIAL — bare and namespaced item names are normalized to lowercase canonical
`namespace:name` IDs at the CLI, domain, and turtle gathering/inventory boundaries. Damage/NBT
constraints and a complete 1.7.10 item registry remain future work.

Represent item ID/damage/NBT constraints sufficiently for 1.7.10 inventory planning.

### CC-101 — Implement bounded excavation skill

**Priority:** P0  
**Dependencies:** CC-044, CC-062

**Status:** PARTIAL — safe one-block-wide, one-block-high tunnel and target-aware gather
primitives have bounded CLI commands; box patterns and full delivery orchestration remain
intentionally incomplete.

Start with simple tunnel/box patterns; every operation bounded.

### CC-102 — Implement gather-resource task state machine

**Priority:** P0  
**Dependencies:** CC-101, CC-045, CC-064

**Status:** PARTIAL — a pure bounded gather workflow contract and persistent parent/step linkage
now model targeted gather, known-cell destination navigation, allowlisted deposit, completion, and
safe blocking. The scheduler can dispatch the first protocol step and command events advance the
workflow idempotently. Inventory-full failures now attempt a bounded return to the named container,
deposit the collected quantity, and queue a fresh gather step; if the route or evidence is
insufficient, the workflow pauses with an explicit resume instruction. Target-stack-aware local
capacity checks now avoid false inventory-full failures when an existing item stack still has room;
full capacity planning, destination-content postcondition verification, and full live acceptance
remain.

### CC-103 — Implement known-container deposit skill

**Priority:** P0  
**Dependencies:** CC-045, CC-064

**Status:** PARTIAL — deposit/withdraw commands now accept a validated container ID and resolve it
through a local front/up/down allowlist; named-location approach/docking and post-transfer inventory
evidence are enforced by the gather workflow. Inspecting the destination's actual contents remains
optional peripheral-specific hardening.

### CC-104 — Implement known-container withdraw skill

**Priority:** P1  
**Dependencies:** CC-045, CC-064

**Status:** PARTIAL — the turtle runtime and operator CLI now support bounded withdraw commands
with an optional allowlisted container ID; higher-level workflow use and postcondition checks
remain.

### CC-007 — Automatic CraftOS startup hook

**Priority:** P0
**Dependencies:** CC-030, CC-040

**Status:** PARTIAL — the installer and stable gateway/turtle recovery bootstraps now validate and
repair a missing, malformed, or directory-valued extensionless `startup` hook while preserving the
previous hook for inspection. Live post-reboot validation on both transports remains outstanding.

The runtime must start automatically after installation, reboot, and successful OTA activation.

### CC-105 — First useful natural-language acceptance

**Priority:** P0  
**Dependencies:** CC-097, CC-102, CC-103

**Status:** PARTIAL — the protected read-only `goal-preflight` API and CLI now report the
control-plane prerequisites (worker online/idle state, advertised capabilities, confirmed anchor,
named destination, and known walkable route) without persisting work. Operator anchors survive
ordinary same-coordinate telemetry heartbeats but are invalidated by a changed reported
coordinate. New installs advertise the full first-use capability set, and the pinned installer
includes a backup-first `enable-gather.lua` helper for older explicit capability lists. Live
execution and verified delivery remain outstanding.

Pass live acceptance:

```text
@alice get 64 cobblestone and deposit it in Test Chest
```

Do not mark complete until delivery quantity is verified.

---

## Epic L — Construction

### CC-110 — Define blueprint schema

**Priority:** P1  
**Dependencies:** CC-020

Include origin, relative coordinates, material requirements, optional placement ordering, bounds.

### CC-111 — Implement blueprint validator/material bill

**Priority:** P1  
**Dependencies:** CC-110

Reject out-of-bounds/invalid/oversized plans according to policy; calculate required materials.

### CC-112 — Implement turtle placement executor

**Priority:** P1  
**Dependencies:** CC-062, CC-044, CC-110

### CC-113 — Implement desired-state build verification

**Priority:** P1  
**Dependencies:** CC-112

Skip already-correct cells and verify final state where observable.

### CC-114 — Implement build partitioner for multiple workers

**Priority:** P1  
**Dependencies:** CC-074, CC-113

Partition non-overlapping regions/materials and avoid worker collision.

### CC-115 — Natural-language design-to-blueprint planner

**Priority:** P1  
**Dependencies:** CC-085, CC-110, CC-111

Codex generates structured design/blueprint, not arbitrary Lua.

### CC-116 — First autonomous construction acceptance

**Priority:** P1  
**Dependencies:** CC-105, CC-115, CC-113

Pass bounded live test for small stone hut including material acquisition.

---

## Epic M — Memory and world knowledge

### CC-120 — Implement memory store/service

**Priority:** P1  
**Dependencies:** CC-020

Support private agent/team/world/project/user scopes plus freshness metadata.

### CC-121 — Implement relevant memory retrieval

**Priority:** P1  
**Dependencies:** CC-120, CC-086

Start with structured filters/text search; embeddings are optional later.

### CC-122 — Persist/retrieve project history summaries

**Priority:** P1  
**Dependencies:** CC-120

### CC-123 — World knowledge invalidation/freshness rules

**Priority:** P1  
**Dependencies:** CC-060, CC-120

Observed physical state supersedes stale memory.

---

## Epic N — AE2/OpenPeripheral

### CC-130 — Build peripheral discovery utility

**Priority:** P1  
**Dependencies:** CC-031

Lua tool lists attached peripheral types/methods and sends result to VPS/prints it.

### CC-131 — Document actual AE2/OpenPeripheral API surface

**Priority:** P1  
**Dependencies:** CC-130

Run against the live modpack and commit a technical note with exact methods/types.

### CC-132 — Implement AE2 storage read adapter

**Priority:** P1  
**Dependencies:** CC-131

### CC-133 — Implement AE2 deposit/withdraw adapter

**Priority:** P1  
**Dependencies:** CC-132

### CC-134 — Integrate AE2 inventory with resource planner

**Priority:** P1  
**Dependencies:** CC-074, CC-133

### CC-135 — AE2 autocrafting feasibility spike

**Priority:** P2  
**Dependencies:** CC-131

---

## Epic O — Mekanism

### CC-140 — Research installed Mekanism ComputerCraft exposure

**Priority:** P1  
**Dependencies:** CC-130

Document whether existing peripherals expose required data/configuration.

### CC-141 — Define minimal Mekanism peripheral addon contract

**Priority:** P1  
**Dependencies:** CC-140

Only if existing integration is insufficient.

### CC-142 — Implement read-only Mekanism adapter

**Priority:** P1  
**Dependencies:** CC-141 if needed

### CC-143 — Implement selected machine configuration writes

**Priority:** P1  
**Dependencies:** CC-142

Feature-gated, typed, verified.

### CC-144 — End-to-end Mekanism automation acceptance

**Priority:** P1  
**Dependencies:** CC-143

Prove one useful processing chain from input to output.

---

## Epic P — DefenseTech

### CC-150 — Research DefenseTech interaction/API surface

**Priority:** P1  
**Dependencies:** CC-130

### CC-151 — Implement manufacture/place capability

**Priority:** P1  
**Dependencies:** CC-150, CC-112

### CC-152 — Implement configure/arm adapter

**Priority:** P1  
**Dependencies:** CC-150

### CC-153 — Implement fire/use adapter

**Priority:** P1  
**Dependencies:** CC-152

Keep disabled by default during development.

### CC-154 — DefenseTech audit/canary acceptance

**Priority:** P1  
**Dependencies:** CC-153, CC-024

Verify high-retention audit, feature gate, bounded canary action.

---

## Epic Q — Restart/recovery and unattended operation

### CC-160 — Control-plane restart reconciliation

**Priority:** P0  
**Dependencies:** CC-023, CC-012

**Status:** DONE — control-plane startup marks gateways/workers offline, cancels uncertain command
delivery, pauses assigned tasks behind explicit resume, queues transport-aware worker stops, and
writes high-retention recovery audit records. Stale-worker and gateway/turtle boot recovery use the
same explicit-resume boundary.

Persist jobs, rediscover gateway/workers, refresh observations, resume/replan.

### CC-161 — Gateway restart reconciliation

**Priority:** P0  
**Dependencies:** CC-034, CC-047

**Status:** DONE — a changed gateway boot ID cancels uncertain command delivery, pauses assigned
tasks behind explicit resume, queues worker stops, and records a high-retention recovery event.

Use boot/session IDs to avoid assuming prior in-flight command state.

### CC-162 — Turtle restart reconciliation

**Priority:** P0  
**Dependencies:** CC-041, CC-047

**Status:** DONE — a changed turtle boot ID cancels uncertain transport delivery, pauses assigned
tasks behind explicit resume, queues a transport-specific stop, and records a high-retention
recovery event for direct HTTP and gateway-backed workers.

Runtime-specific resume state and a live reboot canary remain future validation work.

### CC-163 — No-human-online/chunk-loading spike

**Priority:** P0  
**Dependencies:** CC-051

**Status:** PARTIAL — the runtime safety boundary and bounded validation procedure are documented;
the live test and server-specific chunk-loading choice remain pending. The system does not claim
that a turtle can execute while its chunk is unloaded.

Test whether turtles can continue intended work with humans offline and across required chunks. Document infrastructure needed if not.

### CC-164 — Automatic reasoning outage resume

**Priority:** P0  
**Dependencies:** CC-089, CC-160

**Status:** PARTIAL — failed planner triggers are released to the durable queue and retried by the
production planner loop after the outage gate opens; outage state is persisted across control-plane
restarts. A broader recovery sweep, operator controls, and richer retry policy remain.

---

## Epic R — Operational tooling

### CC-170 — Implement feature-gate service/CLI

**Priority:** P0  
**Dependencies:** CC-024

**Status:** PARTIAL — an environment-backed skill allowlist, protected inspection endpoint, and
`feature-gates` CLI command now gate operator command/task dispatch. Persistent per-worker gates,
canary limits, and audit-history integration remain.

### CC-171 — Implement dry-run/plan-only mode

**Priority:** P0  
**Dependencies:** CC-085, CC-170

**Status:** PARTIAL — physical command, stop-control, update, and addressed gather-goal CLI
requests support `--dry-run`, which validates and constructs a bounded preview locally without
contacting the control plane. The opt-in planner loop records plan-only decisions and exposes
outage status; task planning previews, decision review tooling, and feature-gate integration
remain.

### CC-172 — Implement agent/project inspection CLI

**Priority:** P0  
**Dependencies:** CC-023

**Status:** DONE — protected agent and project inspection endpoints are exposed through the CLI as
`agents`, `agent <name>`, and `projects`; project summaries include job and task counts.

### CC-173 — Implement structured logging with lineage fields

**Priority:** P0  
**Dependencies:** CC-024

**Status:** DONE — control-plane lifecycle, scheduler/recovery failures, and HTTP requests emit
JSON logs with request correlation IDs and safe lineage fields; secret-like values are redacted.
Recent persisted audit events are also available through protected API/CLI inspection.

### CC-174 — Implement retention cleanup jobs

**Priority:** P1  
**Dependencies:** CC-024

**Status:** DONE — the control plane runs a bounded cleanup job for expired STANDARD and HIGH audit
events using configurable windows while preserving IMMUTABLE history.

### CC-175 — Package ComputerCraft Lua release bundle

**Priority:** P0  
**Dependencies:** CC-030, CC-040
**Status:** DONE — `npm run release:lua` creates a secret-free, manifest-backed ZIP bundle.

### CC-176 — Write friend-side installation/update guide

**Priority:** P0  
**Dependencies:** CC-175, CC-052
**Status:** DONE — gateway/turtle installation, configuration, manual paste fallback, and bounded
rollout guidance are documented.

Guide must assume no user SSH access and minimize friend effort.

---

## Epic S — Optional future backends/features

### CC-200 — CustomNPC+ backend feasibility spike

**Priority:** P2  
**Dependencies:** first useful ComputerCraft release

Only pursue if turtle limitations materially block desired tasks.

### CC-201 — Transport adapter framework

**Priority:** P2

### CC-202 — Cross-dimensional portal support

**Priority:** P2  
**Dependencies:** CC-065, CC-201

### CC-203 — Web dashboard

**Priority:** P2

### CC-204 — Multi-user ownership/permissions

**Priority:** P2

---

# Suggested first Codex work sequence

Codex should start approximately in this order:

```text
CC-001 → 002 → 003
       → 010 → 011 → 012 → 013 → 014 → 015
       → 020 → 021 → 022 → 023 → 024
       → 030 → 031 → 032 → 033 → 034 → 035
       → 040 → 041 → 042 → 043 → 044 → 045 → 046 → 047
       → 050 → 051 → 053 → 052
       → 060 → 061 → 062 → 064 → 065
       → 070 → 071 → 072
       → 080 → 081 → 082 → 084 → 085 → 086 → 087 → 089
       → 090 → 091
       → 100 → 101 → 102 → 103 → 105
```

At **CC-105**, stop and evaluate the architecture based on a real useful turtle before investing heavily in construction/mod adapters.
