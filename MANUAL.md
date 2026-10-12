# Sephral’s Content Backup & Restore Manual

This manual covers the details. For a quick overview see the [README](README.md).

## Getting started

1. Enable the module in Foundry.
2. Open the context menu on any supported document, or click `Open SCBR` in the module settings.
3. Create, restore, delete or recover backups in the backup window.

Supported documents: scenes, actors, items, journal entries, playlists, macros, roll tables and cards.

## Restore and recovery

* A restore asks for confirmation first. With the setting *Backup before restore* (on by default) the current state is saved as a backup before the restore, so a restore can be undone with one click.
* The recovery view lists deleted documents that still have a backup. Recovered documents keep their original ID, so links, linked tokens and combat entries work again.
* Each backup remembers the Foundry version and the game system version it was made with. When a backup comes from another Foundry generation or system version, the restore shows a warning. The backup list shows these versions as a tooltip.

## Settings

* *Open SCBR* opens the backup window.
* *Language* follows Foundry (including community translations) or uses English or German. Personal setting.
* *Design* switches the window between *Signature* and *Foundry Default*. Personal setting.
* *Backup before restore* saves the current state before every restore. World setting, on by default.

## Where backups are kept

Backups are saved as files in your world folder, in the subfolder `scbr`. They travel with the world, so a copy of the world folder includes them.

On [The Forge](https://forge-vtt.com/) the world folder is not writable, so backups go to your Assets Library, in the folder `sephrals-content-backup-restore`. Backups from earlier versions move there automatically. Deleting a backup removes it from the list, to free the space completely delete that folder in the Assets Library.

## Macros

GMs can create and restore backups from macros through `game.modules.get("sephrals-content-backup-restore").api`. Players get an error.

* `createBackup(document, name)` saves a backup without a dialog. Without a name the document name is used.
* `listBackups(document)` returns the backups of a document, newest first. Without a document it returns all backups.
* `restoreBackup(document, backupId, { confirm })` restores a backup. With `confirm: false` the confirmation dialog is skipped. *Backup before restore* still applies. It returns `true` after a restore and `false` when the dialog was cancelled.
* `reconstruct(backupId)` recovers a deleted document from a backup and returns it.

Example: back up all scenes before a session.

```js
const api = game.modules.get("sephrals-content-backup-restore").api
const name = `Before session ${new Date().toLocaleDateString()}`
for (const scene of game.scenes) await api.createBackup(scene, name)
ui.notifications.info(`${game.scenes.size} scenes backed up.`)
```
