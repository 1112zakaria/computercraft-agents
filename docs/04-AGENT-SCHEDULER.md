# Agent, Project, and Scheduler Model

## 1. Agent definition

Agent identity is application data, not code.

```yaml
id: alice
display_name: Alice
backend: computercraft
worker_binding: turtle-21
groups: [builders]
capability_policy: standard
home_location: Main Workshop
```

Agents SHOULD have roughly identical reasoning behavior. Differences arise primarily from assignments, location, capabilities, inventory, memory, and group purpose.

## 2. Group definition

```yaml
id: miners
display_name: Miners
purpose: Gather ores, stone, fuel, and bulk underground resources.
members: [alice, bob]
preferred_capabilities:
  - mining
  - navigation
  - inventory_transfer
```

Groups are scheduler/context objects, not separate Minecraft entities.

## 3. Project hierarchy

```text
Project
  ├── Goal
  ├── desired state / acceptance criteria
  ├── Plan
  ├── Jobs
  │    └── Tasks
  ├── resource requirements/reservations
  ├── status
  └── history
```

A user request such as `@builders build a workshop here` can become one project containing material acquisition, site preparation, and build tasks.

## 4. Job ownership

Jobs belong to projects/scheduler, not permanently to agents. If a worker disappears, the scheduler MAY reassign eligible work.

```text
Job
  owner_project
  assigned_agent?      # nullable
  required_capabilities
  dependencies
  priority
  status
  resumability metadata
```

## 5. Physical execution invariant

A turtle SHALL execute at most one physical action stream at once.

An agent MAY still have multiple active logical jobs:

```text
Alice
  current_task: build-wall-segment-2
  queued/runnable:
    - restock-stone
    - inspect-ae2
  paused:
    - expand-mine-alpha
```

## 6. Priority model

Recommended ordering:

1. emergency/global stop;
2. direct user instruction;
3. recovery of blocked current operation when needed to reach safe idle;
4. critical scheduled project work;
5. normal project work;
6. standing-policy work;
7. opportunistic/background tasks.

Unlike the earlier humanoid design, biological survival/combat emergency priority is not required.

## 7. Stop vs cancel

`stop`:

```text
RUNNING → PAUSED
```

- stop motion/mutation at next safe primitive boundary;
- preserve job/task state;
- preserve resumability metadata.

`cancel`:

```text
RUNNING/PAUSED/QUEUED → CANCELLED
```

- terminate selected work;
- release reservations as appropriate;
- do not automatically resume.

## 8. Delegation

Agent planners MAY emit:

```json
{
  "type": "delegation_request",
  "capabilities": ["mining"],
  "objective": "obtain 64 iron ore",
  "needed_by": "project-17/task-8"
}
```

The scheduler chooses an assignee based on capability, availability, location, reservations, and priority.

Agents SHALL NOT directly mutate another agent's queue.

## 9. Standing policies

Standing policies have trigger/desired-state semantics.

Example:

```yaml
id: warehouse-cobble-floor
condition:
  resource_below:
    location: Main Warehouse
    item: minecraft:cobblestone
    quantity: 512
desired_state:
  resource_at_least: 512
priority: background
```

Scheduler evaluation creates finite work only when needed.

## 10. Refusal and override

A planner MAY refuse when an objective appears impossible, nonsensical, or grossly wasteful.

The user MAY explicitly override:

```text
REFUSED → override accepted → QUEUED/RUNNABLE
```

The record SHALL retain:

- original refusal reason;
- override authority;
- timestamp;
- task/project lineage.

An override does not make a technically impossible operation possible.

## 11. Project planner escalation

The shared project planner SHOULD automatically activate when signals include:

- multiple agents needed;
- multi-step dependency graph;
- construction with resource acquisition;
- multiple mods/systems;
- cross-dimensional logistics;
- substantial resource estimates;
- repeated replanning/failures.

Simple one-worker goals should avoid the extra planner call.
