# Architecture

## 1. System style

The project is a distributed autonomous-agent control system with a ComputerCraft execution backend.

```text
┌──────────────────────────────── VPS ────────────────────────────────┐
│                                                                    │
│  CLI / Chat Gateway                                                │
│          │                                                         │
│          ▼                                                         │
│  Command + Context Router                                          │
│          │                                                         │
│          ▼                                                         │
│  Project Manager ─────► Shared Project Planner (when complex)      │
│          │                                                         │
│          ▼                                                         │
│  Central Scheduler                                                 │
│     │          │          │                                        │
│     ▼          ▼          ▼                                        │
│ Alice planner Bob planner Charlie planner                          │
│     │          │          │                                        │
│     └──────────┴──────────┘                                        │
│                ▼                                                   │
│          Skill Executor                                            │
│                │                                                   │
│         ComputerCraft Gateway API                                  │
│                                                                    │
│ PostgreSQL: agents/projects/jobs/memory/world/conversation/audit   │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ outbound HTTPS/JSON
═══════════════════════════╪══════════════════════════════════════════
                           ▼
┌──────────────────── Minecraft host ────────────────────────────────┐
│  Gateway computer                         Direct HTTP turtle        │
│  HTTP client + Rednet dispatcher             HTTP client            │
│       │                                           │                 │
│  Rednet / wireless modem                         │                 │
│   ┌───┼──────────┐                               │                 │
│   ▼   ▼          ▼                               │                 │
│ Alice Turtle  Bob Turtle  Charlie Turtle         │                 │
│       │          │          │                     │                 │
│       └──────────┴──────────┴────────────────────┘                 │
│                           ▼                                        │
│                Minecraft world + peripherals                      │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Responsibility split

### VPS control plane owns

- natural-language interpretation;
- explicit addressing and authorization;
- logical agent identities;
- groups;
- projects/jobs/tasks;
- task dependencies;
- scheduling and priorities;
- delegation;
- standing policies;
- Codex integration;
- model tier/escalation logic;
- memory and conversation history;
- named world locations;
- resource planning/reservations;
- construction blueprints/plans;
- high-level verification;
- audit/event storage;
- CLI;
- gateway connection state.

### ComputerCraft gateway owns

- communication with VPS;
- gateway identity/authentication;
- local command queue transport;
- worker registration/discovery;
- Rednet request/response/event routing;
- heartbeat aggregation;
- local bounded buffering during short VPS outages;
- translating versioned gateway messages to turtle runtime messages.

The gateway is required only for workers using `gateway-rednet`. It is not a proxy for
`direct-http` workers.

### Direct HTTP turtle owns

- outbound HTTPS registration, heartbeat, command polling, and event submission;
- durable poll cursor and bounded event outbox;
- direct update manifest/file downloads from immutable GitHub releases;
- the same deterministic command executor, stop path, and rollback bootstrap as a
  gateway-backed turtle.

### Turtle runtime owns

- movement primitives;
- orientation tracking;
- dig/place/inspect/attack/craft/equip/suck/drop primitives;
- local inventory snapshot;
- fuel observation;
- deterministic micro-skills;
- cancellation checks;
- blocked-path observation;
- execution acknowledgements/events;
- limited local safety/budget enforcement.

## 3. Logical agent vs physical turtle

A logical agent is a persistent application entity. A turtle is an execution device.

```text
Logical Agent: Alice
  id: alice
  goals: persistent
  memory: persistent
  projects: persistent
  groups: [builders]
  capability policy: ...
        │
        ▼ binding
Physical Worker:
  backend: computercraft
  computer_id: 21
  label: alice-turtle
  position: observed/cached
  inventory: observed/cached
```

v1 MAY use a stable one-to-one binding. The data model SHALL not require it forever.

## 4. Backend abstraction

The scheduler SHALL target a capability-oriented worker abstraction rather than ComputerCraft-specific APIs.

```text
WorkerBackend
  observe(worker)
  execute(skillInvocation)
  stop(worker)
  capabilities(worker)
  health(worker)       # execution health, not biological health
```

ComputerCraft is the first implementation:

```text
ComputerCraftBackend
  ├── GatewayClient
  │   └── Rednet Turtle Runtime
  └── DirectWorkerClient
      └── HTTP Turtle Runtime
```

Future implementations MAY include CustomNPC+ or Forge workers without replacing the scheduler or agent model.

## 5. Reasoning architecture

```text
Event
  │
  ▼
Context assembler
  ├── goal/project state
  ├── current worker observation
  ├── relevant world knowledge
  ├── relevant memories
  ├── available skills/capabilities
  └── recent conversation
  │
  ▼
ReasoningProvider
  └── CodexCliProvider (read-only, ephemeral v1 boundary)
  │
  ▼
Structured decision
  ├── continue skill
  ├── create tasks
  ├── request delegation
  ├── replan
  ├── refuse
  ├── report
  └── escalate project planning
```

The planner SHALL operate on semantic skills, not raw turtle APIs.

The context assembler bounds each section and labels goal, task, worker, world, memory, and
conversation records as untrusted data. Relevance selection and persistence-backed retrieval are
separate planner work; the assembler does not authorize actions.

The reasoning package validates structured decisions before they can be consumed by a planner.
The supported v1 decision kinds are `plan`, `create-task`, `continue`, `delegate`, `replan`,
`refuse`, and `report`. The fake provider is deterministic and test-only; it does not authorize
world mutations or bypass the control plane. The CLI provider invokes `codex exec` in an
ephemeral read-only sandbox, sends only a structured planning prompt, passes a sanitized child
environment, and validates the returned JSON again locally. Its output is still inert until a
planner service persists and dispatches the resulting semantic tasks.
Provider calls pass through a concurrency limiter before production planner integration so queued
requests can be cancelled and the control plane does not create an unbounded number of Codex
processes.

Bad planner interface:

```text
forward(); left(); dig(); forward(); ...
```

Preferred planner interface:

```text
gather_resource(item="minecraft:cobblestone", quantity=128, destination="Main Warehouse")
build_blueprint(blueprint_id="house-17", origin="Build Site A")
travel_to(location="Mine Alpha")
```

## 6. Scheduling architecture

The scheduler maintains many jobs but permits one action stream per physical turtle.

```text
Project
  ├── Task A [RUNNING → Alice]
  ├── Task B [RUNNABLE → Bob]
  ├── Task C [BLOCKED by A]
  └── Task D [RUNNABLE, unassigned]
```

Agents MAY propose/decompose work, but task ownership is granted centrally.

## 7. State authority

| State | Authority |
|---|---|
| Project/job/task | PostgreSQL/control plane |
| Agent identity/groups/policies | PostgreSQL/config |
| Conversation/history | PostgreSQL |
| Named locations/world knowledge | PostgreSQL |
| Turtle inventory | Turtle observation (VPS cache) |
| Turtle position/orientation | Turtle runtime + reconciliation (VPS cache) |
| Turtle fuel | Turtle observation |
| Block/world state | Minecraft observations |
| AE2/Machine state | Peripheral observation at time of use |

The VPS SHALL not pretend cached physical state is authoritative after disconnect/restart.

## 8. Transport topology

Gateway-backed transport:

```text
Gateway Computer ──HTTPS request/poll──► VPS public ingress
Gateway Computer ◄──── HTTPS response ── VPS public ingress
Gateway Computer ──HTTPS event batch───► VPS public ingress

Gateway Computer ⇄ Rednet ⇄ Turtles
```

Direct transport:

```text
Direct Turtle ──HTTPS request/poll──► VPS public ingress
Direct Turtle ◄──── HTTPS response ── VPS public ingress
Direct Turtle ──HTTPS event batch───► VPS public ingress
```

The VPS ingress SHALL allow gateway traffic only from configured source CIDRs. The first
deployment allowlist is `51.161.113.44/32`, the friend's Minecraft-host address, and MUST be
verified before enabling live access. The control-plane process itself SHALL bind only to a
non-public listener (loopback or a private container-network bridge); a TLS reverse proxy is the
public boundary.

The ComputerCraft endpoint initiates every HTTP connection in both transports. The VPS returns
commands only in responses to registration, heartbeat, event, or command-poll requests; it does
not make unsolicited HTTP requests to a ComputerCraft computer. This is intentionally simpler than
a custom Forge RPC listener.

If ComputerCraft 1.75 HTTP restrictions prevent HTTPS access to the configured public hostname,
resolve that through ComputerCraft configuration or a minimal bridge before redesigning the whole
system.

## 9. Why a gateway computer

A gateway reduces complexity:

- one VPS connection identity;
- one HTTP whitelist/config target;
- turtles do not need HTTP capability/modems beyond local Rednet;
- centralized buffering/retry;
- easier diagnostics;
- turtle worker programs remain small;
- future peripheral services can be attached to the gateway.

These benefits apply when multiple turtles use `gateway-rednet`. A direct turtle trades the
gateway's centralized buffering and local routing for lower hardware/setup cost and one fewer
runtime hop.

## 10. Architecture constraints

- No LLM call from Lua.
- No arbitrary Codex-generated Lua executed by turtles in normal operation.
- No unbounded local turtle loops.
- No reliance on hidden server omniscience for core navigation.
- No assumption that cached position/inventory survived a physical world change.
- No requirement for a custom Forge worker entity in the ComputerCraft-first design.
