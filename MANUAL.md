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

## Encounter states

When a combat starts, the module saves the state of the fight. The GM can bring the scene back to that state with one click, for a rerun or after a mistake.

What a state holds:

* the hit points and all other values of every combatant, including spell slots and resources, and the uses and quantities of their items
* the effects and conditions of every combatant
* the position, visibility, size and light of every token on the scene, and which tokens exist
* the state of the doors and the hidden state of the lights of the scene
* the round, turn, initiative and defeated marks of the combat
* the sounds that play right now (the setting *Include the playing music* turns this off)

Where to find it:

* The camera button in the header of the combat tracker saves the state now, with a name. The back arrow button resets the scene to the newest state of this combat. Both are GM only.
* The menu of the combat tracker (three dots) has the same two entries and a list of the saved states.
* The backup window has the button *Encounter states* with the list. There the GM resets to any state, removes one or saves the current state without a combat.

What a reset does:

* It shows what will change and asks for confirmation. With the setting *Backup before restore* the current state is saved first as the state *Before reset*, so a reset can be undone with the same button.
* Tokens, doors, lights, hit points and resources, items, effects, round and turn go back to the saved values. Effects and conditions added since are removed. Deleted tokens, items and effects come back with their old ids.
* Linked tokens use the world actor, unlinked tokens their own data. Both are saved and restored the way they live in the scene.
* Only the scene, the combat and the characters of that state are touched. Other actors, other scenes, the world actors behind unlinked tokens and playlists outside the saved sounds are never written. Tokens added since stay on the scene, the macro option `removeAddedTokens` removes them.
* Core can drop a write that follows another one on an unlinked token. The reset looks at the result and finishes what is left. If something still differs, a notice says so, and running the reset once more finishes it.
* The reset updates the combat quietly, so no turn start or round start effects run. Other modules that listen to document updates still see the changes.

Where the states are kept: as one file per state in the world folder `scbr/encounters` (on The Forge in the Assets Library folder of the module). The settings only hold a short list with names and counts. The setting *Encounter states to keep* (5 by default, 1 to 20) limits the list. Foundry cannot delete files from the browser, so the file of a removed state is emptied.

What it does not cover: changes to the scene itself (walls other than doors, drawings, tiles, fog), items an actor got since and chat messages. Effects that a system keeps in sync with hit points, like the bloodied condition in dnd5e, follow the restored hit points.

## Settings

* *Open SCBR* opens the backup window.
* *Language* follows Foundry (including community translations) or uses English or German. Personal setting.
* *Design* switches the window between *Signature* and *Foundry Default*. Personal setting.
* *Backup before restore* saves the current state before every restore, and before an encounter reset. World setting, on by default.
* *Save the state when a combat starts* saves the encounter state when the GM starts a combat. World setting, on by default.
* *Encounter states to keep* limits how many states are kept. World setting, 5 by default.
* *Include the playing music* saves and restores the sounds that play. World setting, on by default.
* *Run self test* checks the storage folder, the list of backups and their files. Run it after every Foundry update. When a newer Foundry than the tested one is installed, the GM gets a notice once.
* *Save debug file* saves a file for bug reports, see [Debug file](#debug-file).

The gear in the title bar of the backup window opens these settings.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Content Backup & Restore it holds:

* on how many of the last 30 days the module was used
* how often backups are created, restored and deleted, a safety backup is made before a restore, single documents are rebuilt from a backup, encounter states are saved at a combat start or by hand, reset, copied before a reset and removed, and macros call the module
* the settings *Design*, *Language*, *Backup before restore*, *Save the state when a combat starts*, *Encounter states to keep* and *Include the playing music* (only the chosen option)
* where errors occur in the module code: file, line, error type and whether the error arose in the module itself, in Foundry, in the game system or in another module, never the error message or the name of another module

No names, chat messages, notes, dice results or other content of the world are sent.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. It holds the versions of Foundry, the system and the active modules, the settings of the modules and what they recorded, for Content Backup & Restore the storage folder, the number of backups per document type, backups whose document is gone, the number of encounter states and the storage lock. Backup names and document data are left out. Macros call `game.modules.get("sephrals-content-backup-restore").api.saveDebugFile()`.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video and an *Install* button. Foundry installs modules only on its setup screen, so the button copies the module's link (manifest URL) and shows the steps with a short clip. When the GM launches the world again, the window opens once with the new module and its *Enable* button. The list is part of the module. Only a video you start is loaded, from the module page on GitHub.

## Where backups are kept

Backups are saved as files in your world folder, in the subfolder `scbr`. Encounter states are in `scbr/encounters`. They travel with the world, so a copy of the world folder includes them.

On [The Forge](https://forge-vtt.com/) the world folder is not writable, so backups go to your Assets Library, in the folder `sephrals-content-backup-restore`. Backups from earlier versions move there automatically. Deleting a backup removes it from the list, to free the space completely delete that folder in the Assets Library.

## Macros

GMs can create and restore backups from macros through `game.modules.get("sephrals-content-backup-restore").api`. Players get an error.

* `createBackup(document, name)` saves a backup without a dialog. Without a name the document name is used.
* `listBackups(document)` returns the backups of a document, newest first. Without a document it returns all backups.
* `restoreBackup(document, backupId, { confirm })` restores a backup. With `confirm: false` the confirmation dialog is skipped. *Backup before restore* still applies. It returns `true` after a restore and `false` when the dialog was cancelled.
* `reconstruct(backupId)` recovers a deleted document from a backup and returns it.
* `saveEncounterState(combat, { name })` saves the state of the fight of that combat (without a combat the viewed one, or the scene of the canvas) and returns the entry of the list.
* `listEncounterStates()` returns the saved encounter states, newest first.
* `restoreEncounterState(snapshotId, { confirm, removeAddedTokens })` resets the scene to a state. Without an id it uses the newest state of the viewed combat. It returns `{ done, summary, remaining }`.
* `deleteEncounterState(snapshotId)` removes a state from the list.
* `runSelfTest()` runs the self test and returns the problems it found.
* `saveDebugFile()` saves the debug file, see [Debug file](#debug-file).

Example: back up all scenes before a session.

```js
const api = game.modules.get("sephrals-content-backup-restore").api
const name = `Before session ${new Date().toLocaleDateString()}`
for (const scene of game.scenes) await api.createBackup(scene, name)
ui.notifications.info(`${game.scenes.size} scenes backed up.`)
```
