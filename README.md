# Sephral’s Content Backup & Restore

Sephral’s Content Backup & Restore creates, manages, deletes, and reconstructs backups for supported world documents in FoundryVTT.

## Discord

[![Join Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7BjCgDYaBP)

Questions, feedback, and module support are welcome on [Discord](https://discord.gg/7BjCgDYaBP).

## Demo

![SCBR demo](media/demo.gif)

If the embedded preview is not available in your GitHub view, please check the media folder.

## Features

- Named backups for scenes, actors, items, journal entries, playlists, macros, roll tables, and cards
- Restore existing documents from a selected backup
- Recovery view for deleted documents when matching backups are available
- Central module interface for backup management and recovery
- Context menu entry on supported documents for quick access
- Client-side interface settings for language and design
- World-scoped backup payload files with a slim metadata index in module settings

## Usage

1. Enable the module in Foundry.
2. Open the context menu on any supported document, or launch `Open SCBR` from the module settings.
3. Create, restore, delete, or reconstruct backups from the unified interface.

## Storage and migration

- Backup payloads are stored in world data under:
  `worlds/<world-id>/scbr/<DocumentType>.json`
  Each type file contains all backups for that document type.
- The world setting `sephrals-content-backup-restore.backupStore` stores only backup metadata (index), not full document payloads.
- Backup writes are serialized with a world lock so two GMs cannot save conflicting changes at the same time.
- Legacy data is migrated on startup.
