import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, importModule } from "./helpers/test-helpers.mjs";

function createDocument({ id = "doc-1", name = "Alpha", documentName = "Scene", flags = {}, data = {} } = {}) {
  return {
    id,
    name,
    documentName,
    flags,
    toObject() {
      return structuredClone({ _id: id, name, flags: structuredClone(flags), ...data });
    },
    async update(updateData, options) {
      this.lastUpdate = { updateData, options };
    },
    async unsetFlag(scope, key) {
      delete this.flags?.[scope]?.[key];
    }
  };
}

test("registers SCBR settings, menu, ready migration, and context options", async () => {
  const env = createTestEnvironment();
  env.state.localizations.set("scbr.settings.tool.label", "Open SCBR");
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/en.json", { "scbr.test": "EN" });
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/de.json", { "scbr.test": "DE" });

  const { __test__ } = await importModule("scripts/scbr.js");
  await env.hooks.trigger("init");

  assert.equal(env.state.registerCalls.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.settingKey === __test__.STORE_SETTING), true);
  assert.equal(env.state.registerCalls.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.settingKey === __test__.UI_LANGUAGE_SETTING), true);
  assert.equal(env.state.registerMenuCalls.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.key === "backupTool"), true);
  // The debug file of Sephral's modules: the settings button and the part of this module, without the backup index
  const debugMenu = env.state.registerMenuCalls.find((entry) => entry.moduleId === __test__.MODULE_ID && entry.key === "debugFile");
  assert.equal(debugMenu?.config.restricted, true);
  const provider = globalThis.sephralsDebugFiles?.providers.get(__test__.MODULE_ID);
  assert.deepEqual(provider?.omitSettings, [__test__.STORE_SETTING]);
  assert.equal(typeof provider?.recent, "function");
  assert.equal(provider.message, undefined);
  const { details } = provider.recent();
  assert.deepEqual(details.index, { version: __test__.BACKUP_STORAGE_VERSION, backups: 0, byType: {}, withoutDocument: 0, latest: null });
  assert.equal(details.lock.held, false);

  const safetySetting = env.state.registerCalls.find((entry) => entry.moduleId === __test__.MODULE_ID && entry.settingKey === __test__.SAFETY_BACKUP_SETTING);
  assert.equal(safetySetting.config.scope, "world");
  assert.equal(safetySetting.config.config, true);
  assert.equal(safetySetting.config.type, Boolean);
  assert.equal(safetySetting.config.default, true);
  assert.equal(__test__.isSafetyBackupEnabled(), true);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, false);
  assert.equal(__test__.isSafetyBackupEnabled(), false);

  const contextOptions = [];
  await env.hooks.trigger("getSceneContextOptions", null, contextOptions);
  assert.equal(contextOptions.length, 1);
  assert.equal(typeof contextOptions[0].callback, "function");

  await env.hooks.trigger("ready");
  assert.equal(__test__.MODULE_TRANSLATION_CACHE.get("en")?.["scbr.test"], "EN");
  assert.equal(__test__.MODULE_TRANSLATION_CACHE.get("de")?.["scbr.test"], "DE");

  env.cleanup();
});

test("core helpers normalize language, paths, backup labels, and selection state", async () => {
  const env = createTestEnvironment();
  env.state.localizations.set("scbr.backup.unnamed", "Unnamed Backup");
  env.state.localizations.set("scbr.backup.noDate", "No timestamp");
  env.state.localizations.set("DOCUMENT.Scene", "Scene");
  env.game.i18n.lang = "de-DE";
  env.game.settings.settings.set("sephrals-content-backup-restore.uiLanguage", {});
  env.state.settingsValues.set("sephrals-content-backup-restore.uiLanguage", "default");

  const { __test__ } = await importModule("scripts/scbr.js");
  const backup = { id: "backup-1", name: "", createdAt: "2024-05-04T12:30:00.000Z", documentType: "Scene" };

  assert.equal(__test__.normalizeUiLanguage("de-DE"), "de");
  assert.equal(__test__.getModuleLanguage("default"), "de");
  assert.equal(__test__.sanitizePathSegment("Scene: Test / Name"), "Scene-Test-Name");
  assert.equal(__test__.normalizeStoragePath("worlds/test-world/scbr/Scene.json#backup-1"), "Scene.json#backup-1");
  assert.deepEqual(__test__.parseBackupPath("Scene.json#backup-1"), {
    normalized: "Scene.json#backup-1",
    filePath: "Scene.json",
    backupId: "backup-1",
    documentType: "Scene"
  });
  assert.equal(__test__.buildBackupStoragePath({ id: "backup-1", documentType: "Scene" }), "Scene.json#backup-1");
  assert.equal(__test__.getBackupFileName("Scene.json#backup-1"), "Scene.json");
  assert.equal(__test__.getBackupDirectoryPath("folders/Scene.json#backup-1"), "folders");
  assert.equal(__test__.getDocumentTypeLabel("Scene"), "Scene");
  assert.equal(__test__.formatBackupLabel(backup).startsWith("Unnamed Backup ("), true);

  const entries = [
    { backup: { documentType: "Scene", documentId: "doc-1", documentName: "Alpha" }, document: null },
    { backup: { documentType: "Scene", documentId: "doc-2", documentName: "Beta" }, document: null },
    { backup: { documentType: "Actor", documentId: "doc-3", documentName: "Gamma" }, document: null }
  ];
  assert.equal(__test__.getFilteredEntries(entries, { documentType: "Scene", documentId: "doc-2" }).length, 1);

  env.cleanup();
});

test("backup helpers normalize payloads, legacy flags, and reconstruction data", async () => {
  const env = createTestEnvironment();
  env.state.localizations.set("scbr.backup.unnamed", "Unnamed Backup");
  env.state.localizations.set("DOCUMENT.Scene", "Scene");

  const liveScene = createDocument({
    id: "scene-1",
    documentName: "Scene",
    name: "Live Scene",
    flags: {
      "sephrals-content-backup-restore": { documentBackups: [{ id: "legacy-1", data: { name: "Legacy" } }] },
      "backup-tool": { sceneBackup: [{ id: "legacy-2", data: { name: "Legacy Scene" } }] }
    },
    data: { flags: { "sephrals-content-backup-restore": { transient: true } } }
  });
  env.setCollection("Scene", [liveScene]);

  const { __test__ } = await importModule("scripts/scbr.js");
  const payload = __test__.buildBackupPayload(liveScene, "Snapshot");
  assert.equal(payload.name, "Snapshot");
  assert.equal(payload.documentId, "scene-1");
  assert.equal(payload.data.flags?.[__test__.MODULE_ID], undefined);

  const normalized = __test__.normalizeBackup({
    id: "backup-1",
    documentId: "scene-1",
    documentName: "Live Scene",
    documentType: "Scene",
    path: "Scene.json#backup-1",
    data: { foo: "bar" }
  });
  assert.equal(normalized.path, "Scene.json#backup-1");

  const reconstructed = __test__.buildReconstructionData({
    documentName: "Rebuilt Scene",
    data: {
      _id: "old-scene",
      folder: "missing-folder",
      flags: { [__test__.MODULE_ID]: { internal: true } }
    }
  });
  assert.equal(reconstructed._id, undefined);
  assert.equal(reconstructed.folder, null);
  assert.equal(reconstructed.flags?.[__test__.MODULE_ID], undefined);

  const originalId = "a1B2c3D4e5F6g7H8";
  const keptBackup = { documentId: originalId, documentName: "Kept", data: { _id: originalId, items: [{ _id: "i1B2c3D4e5F6g7H8" }] } };
  const kept = __test__.buildReconstructionData(keptBackup, originalId);
  assert.equal(kept._id, originalId);
  assert.equal(kept.items[0]._id, "i1B2c3D4e5F6g7H8");
  assert.equal(kept.name, "Kept");
  assert.equal(keptBackup.data.name, undefined);

  assert.equal(__test__.isValidDocumentId(originalId), true);
  assert.equal(__test__.isValidDocumentId("scene-1"), false);
  assert.equal(__test__.isValidDocumentId(null), false);
  const freeCollection = { get: () => null };
  const takenCollection = { get: (id, options) => (options?.invalid && id === originalId ? {} : null) };
  assert.equal(__test__.getReconstructionId(keptBackup, freeCollection), originalId);
  assert.equal(__test__.getReconstructionId({ data: { _id: originalId } }, freeCollection), originalId);
  assert.equal(__test__.getReconstructionId(keptBackup, takenCollection), null);
  assert.equal(__test__.getReconstructionId({ documentId: "scene-1", data: {} }, freeCollection), null);

  const legacyBackups = __test__.getLegacyBackups(liveScene);
  assert.equal(legacyBackups.length, 1);
  assert.equal(legacyBackups[0].documentId, "scene-1");

  env.cleanup();
});