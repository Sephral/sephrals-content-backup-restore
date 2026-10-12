# Sephral’s Content Backup & Restore

Sephral’s Content Backup & Restore creates, manages, deletes, and reconstructs backups for supported world documents in FoundryVTT.

## Foundry VTT

[![Foundry VTT package](https://img.shields.io/badge/Foundry%20VTT-Package%20page-fe6a1f?logo=foundryvirtualtabletop&logoColor=white)](https://foundryvtt.com/packages/sephrals-content-backup-restore)

Install the module from the package browser in Foundry VTT or open its [package page on foundryvtt.com](https://foundryvtt.com/packages/sephrals-content-backup-restore).

## Discord

[![Join Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7BjCgDYaBP)

Questions, feedback, and module support are welcome on [Discord](https://discord.gg/7BjCgDYaBP).

## Demo

![SCBR demo](media/demo.gif)

If the embedded preview is not available in your GitHub view, please check the media folder.

## Features

- Named backups for scenes, actors, items, journal entries, playlists, macros, roll tables, and cards
- Restore existing documents from a selected backup after a confirmation. The current state is saved as a backup first, so a restore can be undone with one click (world setting "Backup before restore", on by default)
- Recovery view for deleted documents when matching backups are available. Reconstructed documents keep their original ID, so links, linked tokens and combat entries work again
- Each backup records the Foundry version and the game system version. When a backup comes from another Foundry generation or system version, the restore shows a warning. The backup list shows these versions as a tooltip
- Central module interface for backup management and recovery
- Context menu entry on supported documents for quick access
- Client-side interface settings for language and design ("Follow Foundry" uses Foundry's language, including community translations)
- World-scoped backup payload files with a slim metadata index in module settings

## Usage

1. Enable the module in Foundry.
2. Open the context menu on any supported document, or launch `Open SCBR` from the module settings.
3. Create, restore, delete, or reconstruct backups from the unified interface.

## API for macros

Macros and world scripts can use the module through `game.modules.get("sephrals-content-backup-restore").api`. Only a GM can call it. Players get an error.

- `createBackup(document, name)` saves a backup without a dialog and returns its index entry. Without a name the document name is used.
- `listBackups(document)` returns the backups of a document, newest first. Without a document it returns all backups.
- `restoreBackup(document, backupId, { confirm })` restores a backup. With `confirm: false` the confirmation dialog is skipped. The world setting "Backup before restore" still applies. It returns `true` after a restore and `false` when the dialog was cancelled.
- `reconstruct(backupId)` recreates a deleted document from a backup and returns it.

Example: back up all scenes before a session.

```js
const api = game.modules.get("sephrals-content-backup-restore").api
const name = `Before session ${new Date().toLocaleDateString()}`
for (const scene of game.scenes) await api.createBackup(scene, name)
ui.notifications.info(`${game.scenes.size} scenes backed up.`)
```

## Storage and migration

- Backup payloads are stored in world data under:
  `worlds/<world-id>/scbr/<DocumentType>.json`
  Each type file contains all backups for that document type.
- The world setting `sephrals-content-backup-restore.backupStore` stores only backup metadata (index), not full document payloads.
- Backup writes are serialized with a world lock so two GMs cannot save conflicting changes at the same time.
- Legacy data is migrated on startup.

## The Forge

On [The Forge](https://forge-vtt.com/) the world folder is not writable, so the module stores its backup files in your Assets Library instead:
`sephrals-content-backup-restore/<world-id>/<DocumentType>.json`

- The absolute Assets Library URL of each file is kept in the backup index next to its relative path and used for reading, deleting, and migrating.
- Backups created before Forge support (under `worlds/<world-id>/...` or in the module folder) stay readable and are moved into the Assets Library folder on startup.
- Deleting a backup rewrites the type file without that entry. To remove the files completely, delete the folder in the Assets Library.
- Off The Forge nothing changes: files stay in the world data folder.
