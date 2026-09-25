# Offline and chunk-loading behavior

This spike records the boundary between what the runtime can guarantee and what the Minecraft
server must provide. It does not claim that a turtle can keep executing while its chunk is
unloaded.

## Runtime behavior

ComputerCraft code executes only while the computer and its surrounding world are available to the
server simulation. A turtle may continue a bounded command without a player watching it, but the
server must keep the turtle's chunk loaded. If the chunk unloads, the turtle cannot make progress
or send heartbeats until the chunk is loaded again.

The direct HTTP client and gateway client therefore use these safety boundaries:

- every physical command has an explicit primitive/block/inventory budget;
- the turtle finishes or safely stops its current bounded primitive sequence rather than inventing
  new work while disconnected;
- the VPS marks a worker stale after the configured timeout;
- stale/restarted workers have their uncertain tasks paused, command delivery cancelled, and a stop
  control queued;
- an operator must inspect the worker and explicitly resume the task after confirming its location
  and world safety.

## Bounded validation procedure

Run this procedure on a disposable or known-safe area after the direct turtle canary is healthy:

1. Record the current worker status and boot ID with `npm run cli -- workers <worker-id>`.
2. Issue a one-step movement or inspection command with `--dry-run` first, then execute it.
3. Move the player away while keeping the turtle's chunk loaded; confirm the command completes and
   the heartbeat/event is visible from the VPS.
4. Cause the turtle's chunk to unload using the server's normal simulation-distance conditions or
   the installed chunk-loading mechanism. Do not use an unbounded command.
5. Confirm the worker stops receiving heartbeats and becomes stale after
   `WORKER_TIMEOUT_SECONDS`.
6. Confirm the assigned task is `PAUSED`, active command delivery is `CANCELLED`, and a worker stop
   control/audit event exists.
7. Reload the chunk, inspect the turtle in-game, and only then run `npm run cli -- resume-task
   <parent-or-task-id>`.
8. Confirm a new heartbeat/boot state and a fresh bounded command execution.

The test passes only if no command is silently assumed complete during the unload interval and the
operator has an explicit recovery boundary.

## Server-side requirement

Offline operation is not equivalent to chunk loading. If work must continue while all players are
offline, the friend's server needs an approved chunk-loading arrangement that covers the turtle's
working area and is compatible with the installed Minecraft/Forge/modpack version. The project does
not enable or invent a chunk loader, because that is server-specific and can have performance or
world-safety consequences.

Record the chosen mechanism, covered coordinates, and unload behavior in the deployment notes before
using unattended physical work. Without such a mechanism, the supported behavior is bounded work
while loaded plus stale-worker recovery after unload.
