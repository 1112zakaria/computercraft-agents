# System Requirements

## 1. Product objective

- **PRD-001** — The system SHALL provide persistent in-world workers that accept natural-language goals and perform Minecraft work autonomously.
- **PRD-002** — Workers SHALL NOT need to behave like human/player entities unless a future skill specifically requires player-context emulation.
- **PRD-003** — The initial execution body SHALL be ComputerCraft turtles.
- **PRD-004** — The initial target SHALL support 3–5 concurrently managed logical workers.
- **PRD-005** — The user SHALL issue high-level goals rather than micromanaging individual movement/action primitives.

## 2. Environment

- **ENV-001** — Target Minecraft version SHALL be Java 1.7.10.
- **ENV-002** — Target server SHALL be Forge 1.7.10.
- **ENV-003** — Minecraft host SHALL be Ubuntu 24.
- **ENV-004** — Server Java is expected to be Java 8; exact build remains to be verified.
- **ENV-005** — Exact Forge build remains to be verified; latest/recommended 1.7.10 is expected.
- **ENV-006** — The modpack already contains ComputerCraft 1.75 and OpenPeripheral-family integrations and SHALL use them before adding custom Forge integration where practical.
- **ENV-007** — The control plane SHALL run on the user's VPS.
- **ENV-008** — The gateway SHALL initiate outbound HTTPS requests to a public VPS control-plane endpoint. The endpoint SHALL admit only configured Minecraft-host source CIDRs and SHALL require application-level gateway authentication.

## 3. Worker identity

- **WRK-001** — Every logical agent SHALL have a stable application-level ID, display name, and configuration.
- **WRK-002** — A logical agent MAY map one-to-one to a turtle in v1.
- **WRK-003** — The architecture SHALL permit future worker backends, including CustomNPC+ or custom Forge workers, without redesigning the scheduler.
- **WRK-004** — Every active turtle SHALL report a stable ComputerCraft computer ID plus configurable worker identity.
- **WRK-005** — A worker SHALL expose a capability set; the scheduler SHALL not assign work requiring unsupported capabilities.

## 4. Natural-language interaction

- **INT-001** — The user SHALL be able to submit natural-language commands through a VPS CLI.
- **INT-002** — Minecraft chat integration SHALL be a target v1 feature; it MAY be delivered after the first turtle execution milestone if a small relay/peripheral is required.
- **INT-003** — Explicit addressing SHALL support `@alice`, named groups such as `@miners`, and `@all`.
- **INT-004** — The user SHALL be able to address multiple named workers.
- **INT-005** — Unaddressed text SHALL target nobody unless conversational context makes the intended recipient sufficiently clear.
- **INT-006** — Conversational replies and material status updates SHALL be visible in both CLI and Minecraft chat once chat integration exists.
- **INT-007** — Agent-to-agent communication SHALL be visible to the user, while scheduler assignment remains authoritative.
- **INT-008** — Only the owner/user SHALL have command authority in v1; other players MAY converse but SHALL NOT control workers.
- **INT-009** — The authorization model SHALL permit future multiple principals/owners without redesigning core objects.

## 5. Context and named places

- **CTX-001** — The system SHALL support persistent named locations such as `Main Warehouse` and `Mine Alpha`.
- **CTX-002** — Named locations SHALL include dimension and coordinates and MAY include bounds, facing, metadata, source, timestamp, and confidence.
- **CTX-003** — `here`, `this`, `that`, `me`, and similar references SHALL be resolvable when the input surface can supply player context.
- **CTX-004** — Static spatial references SHALL be captured at command time.
- **CTX-005** — Dynamic references such as `follow me` MAY remain backend-specific and are not required for the first turtle MVP.

## 6. Projects, jobs, and execution

- **JOB-001** — A user goal MAY create a project containing multiple jobs and tasks.
- **JOB-002** — A logical agent MAY own multiple active jobs, but each turtle SHALL execute at most one physical action stream at a time.
- **JOB-003** — The central scheduler SHALL be authoritative for assignment and task ownership.
- **JOB-004** — Agents MAY request delegation; delegation SHALL pass through the scheduler.
- **JOB-005** — Tasks SHALL support dependencies and prerequisites.
- **JOB-006** — Jobs SHALL support `QUEUED`, `RUNNING`, `PAUSED`, `BLOCKED`, `COMPLETED`, `FAILED`, `REFUSED`, and `CANCELLED` states as applicable.
- **JOB-007** — `stop` SHALL immediately stop turtle motion/action at a safe primitive boundary and preserve work as paused.
- **JOB-008** — `cancel` SHALL terminate the selected job/behavior rather than merely pausing it.
- **JOB-009** — Direct user orders SHALL outrank self-created jobs and standing policies.
- **JOB-010** — Standing policies SHALL be first-class, e.g. `keep 512 cobblestone in warehouse`.
- **JOB-011** — Long-running jobs SHALL persist across VPS and Minecraft server restarts.
- **JOB-012** — After reconnect, workers SHALL reconcile actual state before blindly replaying stale movement/actions.

## 7. Reasoning

- **RSN-001** — Reasoning SHALL be provider-neutral at the application interface.
- **RSN-002** — v1 SHALL use Codex CLI as the reasoning backend.
- **RSN-003** — Routine decisions SHOULD use inexpensive/fast reasoning configuration; difficult decisions SHOULD escalate to a stronger configuration.
- **RSN-004** — The system SHALL enforce a configurable maximum number of concurrent reasoning calls.
- **RSN-005** — Individual logical agents SHALL have independent planner contexts.
- **RSN-006** — A shared project planner SHALL be invoked automatically when project complexity warrants multi-agent/high-level planning.
- **RSN-007** — Reasoning SHALL be event-driven, primarily on new goals, task completion, unexpected state, delegation needs, meaningful failure, or replanning.
- **RSN-008** — Codex SHALL return structured decisions conforming to schemas rather than unrestricted executable Lua for routine operation.
- **RSN-009** — The LLM SHALL NOT directly drive per-tick turtle movement.

## 8. LLM/control-plane outages

- **OUT-001** — If reasoning becomes unavailable while the control plane remains alive, a turtle SHALL finish only its current safe atomic primitive/locally deterministic micro-step and then pause goal-level work.
- **OUT-002** — When reasoning becomes available again, the system SHALL automatically reconcile state and resume eligible work.
- **OUT-003** — If the VPS/control plane is unreachable, gateway/turtles SHALL stop accepting new autonomous goals and enter a bounded safe idle state after finishing a safe atomic action.
- **OUT-004** — Control-plane recovery SHALL not require manual resubmission of persisted projects.

## 9. ComputerCraft execution

- **CC-001** — Turtles SHALL execute movement, dig, place, inspect, attack, craft, equip, suck, and drop via deterministic Lua code where supported.
- **CC-002** — Turtle fuel SHALL be explicitly modeled and planned when fuel is enabled on the server.
- **CC-003** — Turtle inventory capacity SHALL be modeled as a hard physical constraint.
- **CC-004** — The runtime SHALL track position and orientation using dead reckoning and reconciliation checkpoints.
- **CC-005** — Movement routines SHALL report blocked movement and obstacle details instead of looping indefinitely.
- **CC-006** — A gateway computer SHOULD mediate VPS communication and Rednet/modem communication to multiple turtles.
- **CC-007** — Gateway and turtles SHALL use versioned message formats.
- **CC-008** — Turtle programs SHALL persist enough local state to recover identity and determine whether a previously issued execution step is safe to resume.
- **CC-009** — Turtle low-level loops SHALL have operation/time budgets and cancellation checks.

## 10. Navigation and world knowledge

- **NAV-001** — The system SHALL maintain logical coordinates for each turtle.
- **NAV-002** — A navigation layer SHALL route turtles through known traversable cells using a deterministic algorithm such as A*.
- **NAV-003** — The world model SHALL distinguish known free, occupied, hazardous, unknown, and reserved cells where practical.
- **NAV-004** — Workers SHALL be able to explore unknown paths incrementally rather than requiring omniscient world access.
- **NAV-005** — Paths SHALL replan after movement failure or contradictory observations.
- **NAV-006** — Cross-dimensional travel SHALL remain a target requirement, implemented through explicit transport/portal skills rather than treating coordinates across dimensions as continuous space.
- **NAV-007** — Autonomous use of transport systems MAY be added through transport adapters after core turtle navigation.

## 11. Resource work

- **RES-001** — Workers SHALL be able to gather requested resources when accessible using turtle primitives.
- **RES-002** — Resource-gathering jobs SHALL define a target quantity and destination.
- **RES-003** — Mining job success SHALL mean the requested amount was delivered to the destination, not merely discovered/mined.
- **RES-004** — Workers MAY lend/share items and fuel through scheduler-coordinated transfers.
- **RES-005** — Shared resources SHOULD support reservation accounting to reduce duplicate allocation.
- **RES-006** — The system MAY consume rare/high-value resources autonomously; actions SHALL remain auditable.

## 12. Construction

- **BLD-001** — The user SHALL be able to request structures using natural language.
- **BLD-002** — The planner MAY invent dimensions, layout, and material choices when not specified.
- **BLD-003** — Construction SHALL be physically resource-constrained.
- **BLD-004** — The system SHALL calculate or derive a material bill before or during construction.
- **BLD-005** — Missing materials SHALL trigger gathering/delegation rather than item creation.
- **BLD-006** — Construction SHALL use deterministic block-grid placement plans suitable for turtles.
- **BLD-007** — Build tasks SHOULD be idempotent or desired-state driven where practical.
- **BLD-008** — Large builds SHOULD be partitionable among workers without overlapping reservations.
- **BLD-009** — Construction completion SHALL require machine verification plus optional human acceptance.

## 13. Groups

- **GRP-001** — Groups SHALL be persistent domain objects.
- **GRP-002** — Groups SHALL have membership and persistent purpose/role.
- **GRP-003** — Groups MAY define preferred capabilities, task classes, or policies.
- **GRP-004** — Membership changes SHALL not require Minecraft/server restart.

## 14. Memory

- **MEM-001** — The system SHALL separate private agent memory, shared team knowledge, world knowledge, project history, and user preferences.
- **MEM-002** — Conversations SHALL be persisted and queryable.
- **MEM-003** — Old conversation/history SHALL be retrieved or summarized selectively rather than always injected into reasoning context.
- **MEM-004** — World knowledge records SHOULD include source, timestamp, confidence, freshness, and scope.
- **MEM-005** — Actual Minecraft observations SHALL override stale remembered physical state.

## 15. Mod integration priorities

- **MOD-001** — AE2 SHALL be a primary integration target.
- **MOD-002** — Mekanism SHALL be a primary integration target.
- **MOD-003** — DefenseTech SHALL be a primary integration target.
- **MOD-004** — Thaumcraft SHOULD be investigated after core/primary automation.
- **MOD-005** — Existing OpenPeripheral exposure SHALL be preferred over writing custom Java adapters.
- **MOD-006** — Missing peripheral capabilities MAY be implemented through small dedicated ComputerCraft peripheral/bridge mods rather than a general worker runtime.
- **MOD-007** — DefenseTech manufacture/configure/arm/fire MAY be autonomous; capability flags and audit events SHALL still exist.

## 16. Audit and observability

- **OBS-001** — User commands, projects, assignments, decisions, refusals/overrides, and material mod actions SHALL be retained indefinitely unless policy changes.
- **OBS-002** — High-volume turtle primitive logs SHALL have bounded retention.
- **OBS-003** — Debug traces SHALL be configurable and disposable.
- **OBS-004** — Every material action SHOULD be traceable through `user command → project → job → task → worker → skill → primitive → result`.
- **OBS-005** — Plans, current work, dependencies, required resources, and progress SHALL be inspectable from the CLI.

## 17. Live-world operation

- **OPS-001** — Development/testing will occur on the friend's live server/world.
- **OPS-002** — The project SHALL therefore provide global stop and per-worker stop mechanisms before broad autonomous mutation.
- **OPS-003** — New destructive capabilities SHALL start disabled/canary-limited.
- **OPS-004** — Block-change/action budgets SHALL be configurable.
- **OPS-005** — A plan-only/dry-run mode SHALL exist for high-level operations before execution.
- **OPS-006** — The project SHALL NOT require implementing world rollback.

## 18. Deployment

- **DEP-001** — Non-secret configuration MAY be checked into Git.
- **DEP-002** — Secrets/environment-specific credentials SHALL not be committed.
- **DEP-003** — Friend-side setup SHALL be simple and documented because the user does not expect direct SSH/RDP access.
- **DEP-004** — The public gateway endpoint SHALL use TLS and enforce a source-network allowlist independently of application protocol semantics. The initial allowlist SHALL include `51.161.113.44/32` for the friend's Minecraft host, subject to live verification of its actual egress address.
- **DEP-005** — The VPS control plane SHALL remain running when Minecraft intentionally restarts and SHALL reconnect automatically.
- **DEP-006** — Lua programs SHALL be deployable with minimal manual copying/paste steps; repository release bundles/scripts SHOULD be used where possible.
