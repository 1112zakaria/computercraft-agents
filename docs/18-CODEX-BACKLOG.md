# Codex Implementation Backlog

This backlog is written for a coding agent working incrementally in the repository. Items are ordered to reduce risk. Codex SHOULD complete one bounded item at a time, run relevant tests, update documentation when contracts change, and avoid starting later destructive features before prerequisites pass.

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
**Status:** DONE

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
**Status:** IN PROGRESS — bounded move and stop commands are implemented and fake-integrated; the
turtle runtime is installed on worker `alice` (ComputerCraft ID 9), while the live-server
acceptance remains blocked until gateway ID 4 and the turtle have modems attached.

Before Codex, prove `worker move/turn` command path end-to-end.

**Acceptance criteria**

- CLI → VPS → gateway → turtle → result works on live server;
- audit/event lineage recorded;
- stop works.

### CC-052 — Milestone-zero connectivity diagnostic

**Priority:** P0  
**Dependencies:** CC-031, CC-051, CC-053

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

---

## Epic G — Navigation and world map

### CC-060 — Implement sparse world-cell model

**Priority:** P0  
**Dependencies:** CC-020, CC-044

Represent observed cells and freshness/worker source.

### CC-061 — Implement A* pathfinding over known cells

**Priority:** P0  
**Dependencies:** CC-060

**Acceptance criteria**

- finds paths in fixture maps;
- honors blocked cells;
- stable deterministic output;
- supports vertical movement.

### CC-062 — Implement path execution skill

**Priority:** P0  
**Dependencies:** CC-042, CC-043, CC-061

**Acceptance criteria**

- turtle follows path;
- blocked step reports observation;
- cancellation checked every step;
- no infinite retry.

### CC-063 — Implement frontier exploration/replan

**Priority:** P1  
**Dependencies:** CC-060, CC-062

**Acceptance criteria**

- can advance through partially unknown corridor/world within budget;
- new observations update map;
- path replans after contradiction.

### CC-064 — Named location service

**Priority:** P0  
**Dependencies:** CC-020

**Acceptance criteria**

- create/list/resolve named locations;
- support approach/docking coordinate;
- planner tools can reference by name.

### CC-065 — Position anchor/recalibration spike

**Priority:** P0  
**Dependencies:** CC-041

Evaluate GPS/manual docking/other available approaches and implement the simplest reliable anchor mechanism.

**Acceptance criteria**

- document chosen method;
- position confidence can return to confirmed after known re-anchor.

---

## Epic H — Scheduler

### CC-070 — Implement runnable-task selection

**Priority:** P0  
**Dependencies:** CC-023, CC-022

Select tasks based on dependencies, worker availability, required capabilities, and priority.

### CC-071 — Enforce one execution stream per worker

**Priority:** P0  
**Dependencies:** CC-070

**Acceptance criteria**

- concurrent scheduler ticks cannot dispatch two commands/tasks to same worker;
- database/locking strategy tested.

### CC-072 — Implement pause/resume/cancel

**Priority:** P0  
**Dependencies:** CC-015, CC-023, CC-071

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

Support request context, structured schema, timeout, cancellation, reasoning tier, and result metadata.

### CC-081 — Implement fake reasoning provider

**Priority:** P0  
**Dependencies:** CC-080

Use in tests/CI without live Codex.

### CC-082 — Implement Codex CLI provider

**Priority:** P0  
**Dependencies:** CC-003, CC-080

**Acceptance criteria**

- invokes Codex CLI safely;
- validates structured output;
- timeout/cancellation handled;
- stdout/stderr captured without leaking secrets;
- provider metadata recorded.

### CC-083 — Reasoning tier configuration

**Priority:** P1  
**Dependencies:** CC-082

Implement `fast`, `standard`, `strong` logical tiers mapped by configuration.

### CC-084 — Reasoning concurrency limiter

**Priority:** P0  
**Dependencies:** CC-082

**Acceptance criteria**

- configurable max concurrent calls;
- queued calls are cancelable;
- scheduler continues deterministic work independently.

### CC-085 — Agent planner structured decision schema

**Priority:** P0  
**Dependencies:** CC-080, CC-023

Define decisions for plan/create-task/delegate/report/refuse/replan.

### CC-086 — Context assembler

**Priority:** P0  
**Dependencies:** CC-064, CC-085

Assemble goal, current job/task, relevant worker observation, skills, world knowledge, memories, recent conversation.

### CC-087 — Event-driven planner trigger service

**Priority:** P0  
**Dependencies:** CC-085, CC-086

Trigger on new goal, meaningful completion/failure, unexpected state, delegation need, replan.

### CC-088 — Shared project planner escalation

**Priority:** P1  
**Dependencies:** CC-087

Implement complexity heuristic and structured project plan output.

### CC-089 — Reasoning outage state machine

**Priority:** P0  
**Dependencies:** CC-082, CC-087

**Acceptance criteria**

- provider failure pauses goal-level reasoning;
- deterministic bounded action can finish;
- automatic reconcile/resume on recovery.

---

## Epic J — Natural-language command system

### CC-090 — Implement deterministic address parser

**Priority:** P0  
**Dependencies:** CC-021

Parse agents/groups/`@all` before reasoning.

### CC-091 — Implement CLI natural-language command

**Priority:** P0  
**Dependencies:** CC-085, CC-090

Example:

```text
agents say '@alice go to Main Workshop'
```

creates goal and starts planner/scheduler flow.

### CC-092 — Implement conversational session context

**Priority:** P1  
**Dependencies:** CC-090, CC-020

Support follow-up targeting without explicit address when context is clear.

### CC-093 — Implement conversation persistence/query CLI

**Priority:** P1  
**Dependencies:** CC-020

### CC-094 — Minecraft chat integration spike

**Priority:** P1  
**Dependencies:** CC-091

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

Represent item ID/damage/NBT constraints sufficiently for 1.7.10 inventory planning.

### CC-101 — Implement bounded excavation skill

**Priority:** P0  
**Dependencies:** CC-044, CC-062

Start with simple tunnel/box patterns; every operation bounded.

### CC-102 — Implement gather-resource task state machine

**Priority:** P0  
**Dependencies:** CC-101, CC-045, CC-064

### CC-103 — Implement known-container deposit skill

**Priority:** P0  
**Dependencies:** CC-045, CC-064

### CC-104 — Implement known-container withdraw skill

**Priority:** P1  
**Dependencies:** CC-045, CC-064

### CC-105 — First useful natural-language acceptance

**Priority:** P0  
**Dependencies:** CC-091, CC-102, CC-103

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

Persist jobs, rediscover gateway/workers, refresh observations, resume/replan.

### CC-161 — Gateway restart reconciliation

**Priority:** P0  
**Dependencies:** CC-034, CC-047

Use boot/session IDs to avoid assuming prior in-flight command state.

### CC-162 — Turtle restart reconciliation

**Priority:** P0  
**Dependencies:** CC-041, CC-047

### CC-163 — No-human-online/chunk-loading spike

**Priority:** P0  
**Dependencies:** CC-051

Test whether turtles can continue intended work with humans offline and across required chunks. Document infrastructure needed if not.

### CC-164 — Automatic reasoning outage resume

**Priority:** P0  
**Dependencies:** CC-089, CC-160

---

## Epic R — Operational tooling

### CC-170 — Implement feature-gate service/CLI

**Priority:** P0  
**Dependencies:** CC-024

### CC-171 — Implement dry-run/plan-only mode

**Priority:** P0  
**Dependencies:** CC-085, CC-170

### CC-172 — Implement agent/project inspection CLI

**Priority:** P0  
**Dependencies:** CC-023

### CC-173 — Implement structured logging with lineage fields

**Priority:** P0  
**Dependencies:** CC-024

### CC-174 — Implement retention cleanup jobs

**Priority:** P1  
**Dependencies:** CC-024

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
