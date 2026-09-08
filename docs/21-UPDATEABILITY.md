# Gateway-managed runtime updates

This project treats remote runtime delivery as an OTA-style operation coordinated by the gateway.
The gateway is the only ComputerCraft component that talks to the VPS. It polls for an update
control, downloads a pinned GitHub release over HTTPS, and transfers only allowlisted turtle
runtime files over Rednet.

## Terminology

- **Telematics** is the remote operational view: registration, heartbeats, worker state, command
  results, update progress, and failure/rollback events.
- **OTA update** is the remote delivery and activation of a new runtime without manually pasting
  every Lua file into a computer or turtle.

The v1 trust model is HTTPS plus an immutable GitHub release tag. Cryptographic signatures and
per-file hashes are intentionally future hardening; the release version is never allowed to be a
branch name such as `main`.

## Release artifacts

Create and verify a release locally with:

```text
npm ci
npm run check
npm run release:lua -- v0.2.0
```

The tag workflow runs the same checks and publishes:

- `computercraft-lua.zip` for manual/bootstrap installation;
- `release-manifest.json` containing the release version, runtime versions, exact managed Lua
  file list, raw GitHub download URLs, and stable bootstrap file list.

The manifest never manages `gateway.conf`, `worker.conf`, gateway outbox files, turtle state,
turtle command-cache files, or update journals. The stable `startup.lua`, `update_bootstrap.lua`,
and `update_manager.lua` files remain available for recovery and are excluded from the managed
runtime file list.

## Operator flow

The operator runs the existing protected CLI on the VPS:

```bash
npm run cli -- update --target worker:alice --version v0.2.0
npm run cli -- update --target fleet:gateway-main --version v0.2.0
npm run cli -- update --target gateway:gateway-main --version v0.2.0
npm run cli -- update-status <update-id>
```

`CONTROL_PLANE_URL` and `CONTROL_PLANE_ADMIN_SECRET` select the control plane. The CLI defaults
the manifest URL to the repository's GitHub release asset; `--manifest-url` or
`UPDATE_MANIFEST_URL_TEMPLATE` can be used for a GitHub-hosted release asset.

The control plane validates the target, immutable version, HTTPS manifest URL, and expiry; it
persists the rollout and rejects overlapping active updates for the same gateway. Repeating the
same `updateId` with the same rollout data is idempotent. Update status and failure information
are visible through `GET /v1/updates` and `GET /v1/updates/:updateId`.

## Worker rollout

1. The update is delivered in the gateway's authenticated poll response.
2. The gateway resolves the worker and sends `worker.update.prepare`.
3. The turtle refuses preparation unless it is idle. This is the stop-then-update policy: an
   operator can issue `stop <worker-id>` first when a command needs longer to cancel.
4. The gateway downloads the manifest and only the `computercraft/turtle/` files listed in it.
5. Files are sent as bounded Rednet begin/chunk/end messages. Chunks are numbered, duplicates are
   harmless, and acknowledgements are required before continuing.
6. The turtle writes to an update-specific staging directory, preserves configuration/state/cache,
   writes an activation journal and rollback copy, then activates and reboots.
7. The turtle registers and heartbeats with the new runtime version. The activation journal is
   confirmed only after startup succeeds; an interrupted activation restores the prior files.

For `fleet:<gateway-id>`, the gateway applies the release to its currently registered workers in
sequence. A failed worker halts the rollout and emits a failure event; a worker that has already
activated can be rolled back by its bootstrap recovery path.

## Gateway self-update

Gateway updates use the same manifest and release source. The gateway stages only
`computercraft/gateway/` managed files, preserves `gateway.conf` and the outbox, writes the
activation journal, creates a rollback copy, replaces the allowlisted files, and reboots. The
stable bootstrap confirms a healthy restart; if startup does not confirm, the next boot restores
the previous runtime.

## Safety boundaries

- No update may write a configuration, secret, state, cache, log, or outbox path.
- No branch URL is accepted as a release source.
- The gateway remains the initiator of every VPS HTTP request; the VPS never opens a connection
  to ComputerCraft.
- Update transfer is bounded by file and chunk limits and has acknowledgement deadlines.
- Update requests, state transitions, and failure/rollback events are persisted for audit.
- Live enablement still requires the gateway and turtle modems and a small canary first.
