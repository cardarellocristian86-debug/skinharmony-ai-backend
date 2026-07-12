# External Backup Protocol

## Canonical files

- `SHARED_MEMORY/external-drive/EXTERNAL_DRIVE_MAP.md`
- `SHARED_MEMORY/external-drive/EXTERNAL_BACKUP_CONFIG.json`
- `SHARED_MEMORY/external-drive/EXTERNAL_BACKUP_STATE.json`
- `packages/core-codex-connector/common-mandatory-read/EXTERNAL_DRIVE_MAP.md`

## Rules

- Mandatory backup interval: every 48 hours.
- If the backup is due and `/Volumes/Esterno/MEC` is not mounted, Codex must ask the owner to connect the external disk before protected work continues.
- Protected connector commands are blocked by the backup preflight when the disk is missing and the backup window is overdue.

## Connector commands

```bash
sh-core-codex external-drive-map
sh-core-codex external-backup-status
sh-core-codex external-backup-run
sh-core-codex external-backup-watch --once --auto-run
```

## Automated watcher

The macOS LaunchAgent runs the watcher every hour. When the 48-hour window expires:

- if the disk is mounted, backup runs automatically
- if the disk is not mounted, the watcher emits a connect-disk alert and Codex must stop protected work until the disk is connected
