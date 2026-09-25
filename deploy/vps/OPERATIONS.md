# VPS operations

The control plane is a systemd service. It logs to the system journal, restarts after an
unexpected failure, and stays independent of Minecraft server restarts.

## Install the service and log policy

```bash
sudo install -o root -g root -m 0644 deploy/vps/control-plane.service.example \
  /etc/systemd/system/computercraft-agents-control-plane.service
sudo install -d -m 0755 /etc/systemd/journald.conf.d
sudo install -o root -g root -m 0644 deploy/vps/journald.conf.example \
  /etc/systemd/journald.conf.d/computercraft-agents.conf
sudo systemctl restart systemd-journald
sudo systemctl daemon-reload
sudo systemctl enable --now computercraft-agents-control-plane
```

Useful checks:

```bash
sudo systemctl status computercraft-agents-control-plane
sudo systemctl restart computercraft-agents-control-plane
sudo journalctl -u computercraft-agents-control-plane -n 100 --no-pager
sudo journalctl -u computercraft-agents-control-plane -f
```

The application must not log bearer secrets, database URLs, request authorization headers, or
certificate private keys. `Restart=on-failure` covers crashes; an operator restart is still
required after updates or configuration changes. During shutdown, the control plane closes idle
and active HTTP sockets before waiting for the server to close. ComputerCraft clients retry
bounded requests and persist event outboxes, so an operator restart does not wait for a long poll
or leave systemd to SIGKILL the process after the stop timeout.

## Safe control-plane rollout

From a clean checkout, check out the reviewed commit and run:

```bash
cd /opt/computercraft-agents
git fetch origin
git checkout --detach <reviewed-commit>
deploy/vps/update-control-plane.sh /opt/computercraft-agents
```

The helper validates the complete repository before restarting systemd and waits for the private
`/healthz` endpoint. It never sources or prints `/etc/computercraft-agents/control-plane.env`.
The control plane closes idle and active HTTP connections during shutdown so ComputerCraft clients
do not make an operator restart wait for the full systemd stop timeout. In-flight requests are
safe to retry because direct worker events are outboxed and the poll cursor is durable.
For rollback, check out the previous deployed commit and run the helper again. Do not use a dirty
working tree for either operation.

## Install PostgreSQL backups

The backup job uses the existing root-owned environment file, writes a PostgreSQL custom-format
dump with mode `0600`, writes a SHA-256 sidecar, and retains fourteen days of local backups.
Configure off-host backup storage separately if the VPS is not the desired disaster-recovery
boundary.

```bash
sudo install -o root -g root -m 0700 deploy/vps/computercraft-agents-postgres-backup \
  /usr/local/libexec/computercraft-agents-postgres-backup
sudo install -d -o ubuntu -g ubuntu -m 0700 /var/backups/computercraft-agents
sudo install -o root -g root -m 0644 deploy/vps/computercraft-agents-postgres-backup.service.example \
  /etc/systemd/system/computercraft-agents-postgres-backup.service
sudo install -o root -g root -m 0644 deploy/vps/computercraft-agents-postgres-backup.timer.example \
  /etc/systemd/system/computercraft-agents-postgres-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now computercraft-agents-postgres-backup.timer
sudo systemctl start computercraft-agents-postgres-backup.service
sudo systemctl status computercraft-agents-postgres-backup.timer
```

Verify a backup without restoring over the live database:

```bash
sudo sha256sum --check /var/backups/computercraft-agents/postgres-*.dump.sha256
sudo pg_restore --list /var/backups/computercraft-agents/postgres-<timestamp>.dump
```

Do not place the database password in the backup script or unit. Keep it only in
`/etc/computercraft-agents/control-plane.env` with mode `0600`.
