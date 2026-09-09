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
out-of-band and must never be committed. On the current VPS, the control plane is reachable only
from the existing Caddy Docker network's private bridge address.

```text
NODE_ENV=production
CONTROL_PLANE_HOST=172.18.0.1
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

The service lifecycle, journald policy, and PostgreSQL backup timer are documented in
[OPERATIONS.md](OPERATIONS.md). The backup job is intentionally a template: install it on the
VPS only after confirming the local backup retention and off-host recovery policy.

## Checks

```bash
curl --fail http://127.0.0.1:8787/healthz
systemctl status computercraft-agents-control-plane
journalctl -u computercraft-agents-control-plane -n 100 --no-pager
```

## Public gateway ingress

The deployed gateway URL is:

```text
https://192.99.69.46.sslip.io:8443
```

`sslip.io` resolves this hostname to the VPS's public IPv4. The existing Caddy container obtains
and renews a publicly trusted certificate through its already-public port 80. It exposes only
`/v1/gateway/*` and `/v1/worker/*` on dedicated port 8443 and forwards to `172.18.0.1:8787`, a
private Docker bridge address unavailable from the public internet.

Docker-published ports bypass ordinary UFW filtering. Therefore both the Caddy `remote_ip` matcher
and `computercraft-agents-docker-firewall.service.example` enforce the `51.161.113.44` source
allowlist. Publish `192.99.69.46:8443:8443` in the Caddy Compose service, install the firewall
script at `/usr/local/libexec/computercraft-agents-docker-firewall`, then enable the service.
Keep TCP 8787 closed to the public internet. Retain the gateway bearer secret: an IP allowlist
alone is not gateway authentication. Before enabling the rule, verify from the friend's host that
outbound requests actually use `51.161.113.44`; update the proxy and firewall together if it
changes.
