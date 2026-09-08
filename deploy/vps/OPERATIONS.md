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
required after updates or configuration changes.

## Install PostgreSQL backups

The backup job uses the existing root-owned environment file, writes a PostgreSQL custom-format
dump with mode `0600`, writes a SHA-256 sidecar, and retains fourteen days of local backups.
Configure off-host backup storage separately if the VPS is not the desired disaster-recovery
boundary.

```bash
sudo install -o root -g root -m 0700 deploy/vps/computercraft-agents-postgres-backup \
  /usr/local/libexec/computercraft-agents-postgres-backup
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
