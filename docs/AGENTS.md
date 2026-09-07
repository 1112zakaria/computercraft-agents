# Instructions for Codex and Other Coding Agents

## Mission

Implement the ComputerCraft-first autonomous Minecraft worker system described in this specification pack. Prefer small, verifiable increments over broad rewrites.

## Before changing code

1. Read `00-README.md`.
2. Read the relevant architecture/spec document.
3. Locate the backlog item in `18-CODEX-BACKLOG.md`.
4. Inspect existing code/tests before designing a replacement.
5. Treat settled ADRs in `16-ARCHITECTURE-DECISIONS.md` as constraints unless a task explicitly changes them.

## Work-unit rule

Work on **one backlog item or one tightly coupled dependency set at a time**.

For every completed item:

- implement the smallest coherent change;
- add/update tests;
- run lint/typecheck/tests relevant to the change;
- update docs/contracts if behavior changed;
- report files changed, tests run, and unresolved risks.

## Architecture rules

- Codex/LLM decides goals/plans; deterministic code executes Minecraft actions.
- Do not place LLM calls in game-tick/movement loops.
- Do not execute arbitrary model-generated Lua as the normal skill mechanism.
- Central scheduler owns assignment.
- One physical action stream per turtle.
- ComputerCraft is the first backend, but scheduler/domain code must not depend directly on turtle implementation details.
- Physical state must be refreshed from turtle/peripheral observations before consequential actions.
- Prefer existing ComputerCraft/OpenPeripheral capabilities before writing a Forge addon.
- If a Forge addon is needed, keep it narrow (chat relay/peripheral adapter), not a general worker engine.

## Live-world safety rules

The real server/world is used for development.

Therefore:

- never enable a new destructive capability by default;
- implement/keep action budgets;
- preserve global/per-worker stop paths without LLM dependency;
- make live mutation tests small and bounded;
- do not run unbounded excavation/build loops;
- do not enable DefenseTech fire capability during ordinary development;
- do not add autonomous self-update that can silently deploy unreviewed code to the live server.

## Secrets

Never commit or print:

- Codex credentials;
- gateway bearer secret;
- PostgreSQL password;
- WireGuard private keys;
- private credentials shared by the user/friend.

Use `.env.example` and redacted configuration examples.

## TypeScript expectations

- strict TypeScript;
- runtime validation at external boundaries;
- explicit domain types/state transitions;
- dependency injection for external systems (DB, Codex, gateway transport) where it improves testability;
- no live Codex dependency in normal CI.

## Lua expectations

ComputerCraft 1.75 is a legacy Lua environment. Avoid assuming modern Lua features unavailable in that runtime.

- keep modules small;
- wrap raw turtle/peripheral APIs;
- use explicit error/result values;
- use bounded retries/backoff;
- check cancellation between primitives;
- keep persistent state minimal and versioned;
- make gateway/turtle messages versioned and validated.

## Testing rule

Prefer this order:

1. unit test;
2. fake/simulated integration test;
3. gateway/local endpoint test;
4. smallest possible live-server canary.

A backlog item requiring live-world mutation is not complete solely because unit tests pass; its documented canary acceptance must also pass when the task reaches that stage.

## Do not silently change requirements

If implementation evidence conflicts with a requirement:

1. preserve the failing requirement/open issue;
2. document the observed limitation;
3. propose an ADR/spec change;
4. do not silently weaken behavior in code.
