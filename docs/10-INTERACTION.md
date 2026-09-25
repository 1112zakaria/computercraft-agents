# User Interaction and Conversation

## 1. Input surfaces

Target surfaces:

1. VPS CLI — required first.
2. Minecraft chat — target v1 feature.

Both SHALL route through the same application command service.

## 2. Addressing

Deterministic explicit parsing occurs before LLM interpretation.

Examples:

```text
@alice get 64 cobblestone
@alice,@bob clear this area
@miners gather iron
@all return to the workshop
```

The deterministic address parser recognizes one or more named targets and the special `@all`
target before reasoning. Names are normalized case-insensitively, and the domain layer provides a
pure registry resolver: a known worker resolves to itself, a known group expands to its currently
registered workers, and `@all` expands to every registered worker. Unknown targets are rejected
rather than silently producing an empty scope. Persistence, authorization, and task creation
remain control-plane responsibilities, and the first single-worker gather API still requires one
named worker. Codex receives only the resolved recipient scope, never raw address syntax.

## 3. Natural unaddressed conversation

Default: nobody receives a controlling command unless context identifies the interlocutor.

```text
User: Alice, how much stone do you have?
Alice: 48 blocks.
User: Bring it here.
```

The second message MAY target Alice due to short-lived session context.

## 4. Agent replies

Agents SHOULD report:

- goal accepted;
- refusal with reason;
- significant plan choice;
- delegation request/assignment where useful;
- blocked condition needing user knowledge;
- completion/failure;
- concise progress for long tasks.

Avoid emitting one chat message per primitive action.

## 5. Agent-agent communication

Visible messages are a presentation of meaningful coordination, not the transport mechanism for assignments.

```text
Alice: I need 96 stone for the workshop floor.
Bob: I can take that resource job after my current delivery.
```

Scheduler records/assigns the actual job.

## 6. Minecraft chat integration options

Because ComputerCraft itself does not inherently receive all normal player chat, implement the lowest-cost compatible option discovered during spike:

### Option A — compatible chat-box peripheral/addon

If the existing pack or a safe 1.7.10 addon exposes chat events/output to ComputerCraft, use it.

### Option B — tiny Forge chat relay

A minimal Forge mod may relay:

```text
player UUID/name
message
position
dimension
look target / targeted block when available
```

to the gateway/VPS and provide outbound chat posting.

This relay is intentionally much smaller than a worker runtime.

### Option C — CLI only for MVP

The earliest end-to-end turtle MVP MAY use CLI while chat integration is developed.

## 7. Deictic references

For `here`, `me`, `this`, `that`, the input adapter needs current player context. The context resolver SHALL not invent it if unavailable.

Example captured reference:

```json
{
  "kind": "static_location",
  "dimension": 0,
  "x": 120,
  "y": 65,
  "z": -41,
  "source": "user_position_at_command"
}
```

## 8. Authorization

v1 recognizes one controlling principal. Chat from other players may be forwarded for conversation, but commands SHALL be marked unauthorized before reaching scheduler execution.
