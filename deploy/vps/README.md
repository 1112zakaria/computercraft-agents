# VPS deployment

The VPS hosts the TypeScript control plane and PostgreSQL. The service is intentionally configured
without Codex credentials; deterministic gateway connectivity is the first live milestone.

## Prerequisites

- Ubuntu 24.04;
- Node.js 20 or newer;
- PostgreSQL 16 or newer;
- Caddy or an equivalent TLS reverse proxy for the public gateway route;
- an `ubuntu`-owned checkout at `/opt/computercraft-agents`;
- a private `control-plane.env` file at `/etc/computercraft-agents/control-plane.env`.

## Environment

Create the environment file with mode `0600`. The bearer secret must be shared with the friend
out-of-band and must never be committed.

```text
NODE_ENV=production
CONTROL_PLANE_HOST=127.0.0.1
CONTROL_PLANE_PORT=8787
DATABASE_URL=postgresql://ccagents:<database-password>@127.0.0.1:5432/computercraft_agents
GATEWAY_BEARER_SECRET=<gateway-secret>
CONTROL_PLANE_ADMIN_SECRET=<operator-secret>
GATEWAY_TIMEOUT_SECONDS=45
WORKER_TIMEOUT_SECONDS=45
MAX_HTTP_BODY_BYTES=1048576
STALE_CHECK_INTERVAL_SECONDS=10
```

## Install/update

```bash
sudo install -d -o ubuntu -g ubuntu -m 0750 /opt/computercraft-agents
git clone git@github.com:1112zakaria/computercraft-agents.git /opt/computercraft-agents
cd /opt/computercraft-agents
npm ci
npm run build
sudo -u ubuntu env $(sudo cat /etc/computercraft-agents/control-plane.env | xargs) npm run db:migrate
sudo install -o root -g root -m 0644 deploy/vps/control-plane.service.example \
  /etc/systemd/system/computercraft-agents-control-plane.service
sudo systemctl daemon-reload
sudo systemctl enable --now computercraft-agents-control-plane
```

For routine updates, pull the desired commit, run `npm ci`, `npm run build`, run the migration
command, and restart the service. Migrations are checksum-protected and run under a PostgreSQL
advisory lock.

## Checks

```bash
curl --fail http://127.0.0.1:8787/healthz
systemctl status computercraft-agents-control-plane
journalctl -u computercraft-agents-control-plane -n 100 --no-pager
```

## Public gateway ingress

Use a public DNS hostname with a trusted TLS certificate. Keep the Node.js process on
`127.0.0.1:8787`; configure Caddy (or equivalent) to expose only `/v1/gateway/*` on port 443.
The repository's `Caddyfile.example` admits only the current Minecraft-host source address,
`51.161.113.44`.

Configure the VPS firewall to admit TCP 443 only from `51.161.113.44` and keep TCP 8787 closed
to the public internet. Retain the gateway bearer secret: an IP allowlist alone is not gateway
authentication. Before enabling the rule, verify from the friend's host that outbound requests
actually use `51.161.113.44`; update the proxy and firewall together if it changes.
