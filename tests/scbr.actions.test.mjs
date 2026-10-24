import assert from "node:assert/strict";
import test from "node:test";

import { createResponse, createTestEnvironment } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import("../scripts/scbr.js");

function createDocument({ id = "scene-1", name = "Scene One", documentName = "Scene", flags = {}, data = {}, unsetFlagError = null } = {}) {
  return {
    id,
    name,
    documentName,
    flags: structuredClone(flags),
    toObject() {
      return structuredClone({ _id: id, name, flags: structuredClone(flags), ...data });
    },
    async update(updateData, options) {
      this.lastUpdate = { updateData, options };
    },
    async unsetFlag(scope, key) {
      if (unsetFlagError) throw unsetFlagError;
      delete this.flags?.[scope]?.[key];
    }
  };
}

function resetState() {
  env.state.registerCalls.length = 0;
  env.state.registerMenuCalls.length = 0;
  env.state.notifications.info.length = 0;
  env.state.notifications.warn.length = 0;
  env.state.notifications.error.length = 0;
  env.state.fetchCalls.length = 0;
  env.state.fetchResponses.clear();
  env.state.fetchImpl = null;
  env.state.uploadCalls.length = 0;
  env.state.uploadImpl = null;
  env.state.uploadResult = null;
  env.state.createDirectoryCalls.length = 0;
  env.state.createDirectoryErrors.clear();
  env.state.browseCalls.length = 0;
  env.state.browseImpl = null;
  env.state.settingWrites.length = 0;
  env.state.settingsValues.clear();
  env.state.settingsRegistry.clear();
  env.game.settings.settings.clear();
  env.state.dialogWaitResult = null;
  env.state.dialogConfirmResult = true;
  env.state.lastDialogWaitOptions = null;
  env.state.lastDialogConfirmOptions = null;
  env.state.windowOpenCalls.length = 0;
  env.state.canvasDrawCalls = 0;
  env.state.localizations.clear();
  __test__.resetModuleTranslationState();
  env.game.i18n.lang = "en";
  env.game.release.generation = 14;
  env.game.user.isGM = true;
  env.game.folders = { get: () => null };
  for (const config of __test__.SUPPORTED_DOCUMENTS) env.setCollection(config.documentName, []);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_LOCK_SETTING}`, {
    token: null,
    owner: null,
    expiresAt: 0,
    acquiredAt: null
  });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: __test__.BACKUP_STORAGE_VERSION,
    backups: []
  });
}

function createVirtualStorage() {
  const files = new Map();
  const normalize = (value) => String(value).replace(/\/+/g, "/").replace(/([^:]?)\/\/+/, "$1/");

  env.state.fetchImpl = async (url) => {
    const clean = normalize(url.split("?")[0]);
    if (!files.has(clean)) return createResponse({ ok: false, status: 404 });
    return createResponse({ ok: true, json: structuredClone(files.get(clean)) });
  };

  env.state.uploadImpl = async (_source, target, file) => {
    const path = normalize(`${target}/${file.name}`);
    files.set(path, JSON.parse(await file.text()));
    return { path };
  };

  return {
    files,
    write(filePath, payload, root = __test__.getWorldStorageRoot()) {
      files.set(normalize(__test__.getBackupFetchUrl(filePath, root)), structuredClone(payload));
    }
  };
}

test.beforeEach(resetState);
test.after(() => env.cleanup());

test("hook lifecycle registers stable settings and context options on the attributed module instance", async () => {
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/en.json", {});
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/de.json", {});

  await env.hooks.trigger("init");
  await env.hooks.trigger("ready");

  const options = [];
  await env.hooks.trigger("getSceneContextOptions", null, options);
  assert.equal(env.state.registerCalls.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.settingKey === __test__.STORE_SETTING), true);
  assert.equal(env.state.registerMenuCalls.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.key === "backupTool"), true);
  assert.equal(options.length > 0, true);
});

test("stable helper coverage exercises localization, theme, path, and translation branches", async () => {
  env.state.localizations.set("DOCUMENT.Scene", "Scene");
  env.state.localizations.set("scbr.document.unknown", "Unknown Document");
  env.state.localizations.set("scbr.backup.unnamed", "Unnamed Backup");
  env.state.localizations.set("scbr.backup.noDate", "No timestamp");
  __test__.MODULE_TRANSLATION_CACHE.set("en", {
    "scbr.override": "Override",
    "scbr.format": "Hello {name}"
  });

  assert.equal(__test__.localize("scbr.override", "Fallback", "en"), "Override");
  assert.equal(__test__.localize("missing", "Fallback"), "Fallback");
  assert.equal(__test__.format("scbr.format", { name: "GM" }, "Fallback", "en"), "Hello GM");
  assert.equal(__test__.format("missing", { name: "GM" }, "Fallback"), "Fallback");
  assert.equal(__test__.interpolateTemplate("A {x} B {y}", { x: 1 }), "A 1 B {y}");
  assert.equal(__test__.getRegisteredSettingValue("unknown", "fallback"), "fallback");

  env.game.settings.settings.set(`${__test__.MODULE_ID}.${__test__.UI_LANGUAGE_SETTING}`, {});
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.UI_LANGUAGE_SETTING}`, "de");
  assert.equal(__test__.getPreferredLanguage(), "de");
  assert.equal(__test__.normalizeUiLanguage(""), "en");
  assert.equal(__test__.normalizeUiLanguage("pt-BR"), "en");
  assert.equal(__test__.getModuleLanguage("en"), "en");

  env.state.fetchImpl = async (url) => {
    if (url.endsWith("de.json")) return createResponse({ ok: true, json: { loaded: "ja" } });
    return createResponse({ ok: false, status: 500 });
  };
  const loaded = await __test__.loadModuleTranslations("de-DE");
  assert.equal(loaded.loaded, "ja");

  __test__.resetModuleTranslationState();
  env.state.fetchImpl = async () => createResponse({ ok: false, status: 500 });
  const translationsLoad = await __test__.ensureModuleTranslationsLoaded();
  assert.equal(translationsLoad, null);
  assert.equal(__test__.getThemePreference(), "signature");

  env.game.i18n.lang = "de-DE";
  assert.equal(__test__.getLocaleForModule("default"), "de-DE");
  assert.equal(__test__.getDocumentType({ constructor: { metadata: { name: "Actor" } } }), "Actor");
  assert.equal(__test__.getSupportedDocumentConfig("Missing"), null);
  env.setCollection("Actor", [{ id: "actor-1", name: "Actor One", documentName: "Actor" }]);
  assert.equal(__test__.getDocumentCollection("Actor").get("actor-1").name, "Actor One");
  assert.equal(__test__.getDocumentTypeLabel(null), "Unknown Document");
  assert.equal(__test__.getDocumentDisplayName({ id: "x", documentName: "Scene", name: "" }), "Scene x");
  assert.equal(__test__.getTimestampString("invalid"), "invalid");
  assert.deepEqual(__test__.getBackupDisplayParts({ name: "", createdAt: null }), { name: "Unnamed Backup", timestamp: "No timestamp" });

  __test__.ensureStylesLoaded();
  __test__.ensureStylesLoaded();
  assert.equal(env.state.appendedHeadElements.length, 1);
  const themed = document.createElement("div");
  __test__.applyDialogTheme(themed, "foundry");
  assert.equal(themed.dataset.uiTheme, "foundry");
  __test__.applyDialogTheme(themed, "signature");
  assert.equal(themed.classList.contains("is-theme-signature"), true);

  assert.equal(__test__.sanitizePathSegment("***", "fallback"), "fallback");
  assert.equal(__test__.getWorldStorageRoot(), "worlds/test-world/scbr");
  assert.equal(__test__.getLegacyWorldStorageRoot(), "worlds/test-world/sephrals-content-backup-restore");
  assert.equal(__test__.normalizeStoragePath("/modules/sephrals-content-backup-restore/storage/Scene.json#x"), "Scene.json#x");
  await __test__.sleep(0);
  assert.equal(__test__.parseBackupPath("", "backup-1", "Scene").backupId, "backup-1");
  assert.equal(__test__.sortBackups([{ createdAt: "2024-01-01" }, { createdAt: "2024-02-01" }])[0].createdAt, "2024-02-01");
  assert.equal(__test__.getRootedStoragePath("Scene.json"), "worlds/test-world/scbr/Scene.json");

  const datasetElement = document.createElement("div");
  datasetElement.dataset.documentId = "scene-1";
  assert.equal(__test__.getContextDataset(datasetElement).documentId, "scene-1");
  assert.equal(__test__.getContextDataset({ data: (key) => ({ entryId: "e", sceneId: "s", documentId: "d" })[key] }).sceneId, "s");
  assert.equal(__test__.getDocumentIdFromContext(datasetElement), "scene-1");
});

test("document actions cover create, restore, reconstruct, remove, and wrapped error handling", async () => {
  const storage = createVirtualStorage();
  const scene = createDocument({ id: "scene-1", name: "Scene One", documentName: "Scene", data: { flags: { [__test__.MODULE_ID]: { transient: true } } } });
  const createdScene = createDocument({ id: "scene-2", name: "Rebuilt Scene", documentName: "Scene" });
  env.setCollection("Scene", [scene], { createResult: async (data) => ({ ...createdScene, createdFrom: data }) });
  env.state.localizations.set("DOCUMENT.Scene", "Scene");
  env.state.localizations.set("scbr.backup.unnamed", "Unnamed Backup");
  env.state.localizations.set("scbr.action.cancel", "Cancel");
  env.state.localizations.set("scbr.action.backup", "Create Backup");
  env.state.dialogWaitResult = "Snapshot";

  await __test__.createBackup(scene);
  const createdIndex = __test__.getBackups(scene)[0];
  assert.equal(createdIndex.name, "Snapshot");
  assert.equal(env.state.notifications.info.length > 0, true);
  assert.equal(Array.from(storage.files.keys()).some((key) => key.endsWith("/Scene.json")), true);

  await __test__.restoreBackup(scene, createdIndex.id);
  assert.equal(scene.lastUpdate.updateData._id, "scene-1");
  assert.equal(env.state.canvasDrawCalls, 1);
  await __test__.restoreBackup(scene, "missing-id");
  assert.equal(env.state.notifications.warn.length > 0, true);

  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      ...__test__.getAllBackups(),
      { id: "other-1", documentId: "scene-9", documentName: "Other Scene", documentType: "Scene", createdAt: "2024-01-03T00:00:00.000Z", path: "Scene.json#other-1" }
    ]
  });

  const reconstructed = await __test__.reconstructDocumentFromBackup(createdIndex);
  assert.equal(reconstructed.id, "scene-2");
  assert.equal(__test__.getAllBackups().some((entry) => entry.documentId === "scene-2"), true);

  env.state.dialogConfirmResult = false;
  await __test__.removeBackup(scene, __test__.getAllBackups()[0]?.id ?? createdIndex.id);
  const countBeforeConfirmedDelete = __test__.getAllBackups().length;
  env.state.dialogConfirmResult = true;
  await __test__.removeBackup(scene, __test__.getAllBackups()[0]?.id ?? createdIndex.id);
  assert.equal(__test__.getAllBackups().length <= countBeforeConfirmedDelete, true);

  const entry = { backup: __test__.getAllBackups()[0], document: null };
  if (entry.backup) {
    await __test__.removeBackupEntry(entry);
  }

  await __test__.runDocumentAction(scene, async () => {
    throw new Error("boom");
  });
  await __test__.runRecoveryAction(async () => {
    throw new Error("recover boom");
  });
  assert.equal(env.state.notifications.error.length >= 2, true);

  assert.equal(__test__.getEntryPrimaryAction({ document: scene }).action, "restore");
  assert.equal(__test__.getEntryPrimaryAction({ document: null }, { recoveryMode: true }).action, "reconstruct");
  assert.equal(__test__.getEntryPrimaryAction({ document: null }), null);
});

test("error branches cover lock contention, storage failures, invalid backups, scene fallback flags, and prompt focus handling", async () => {
  const originalGet = env.game.settings.get.bind(env.game.settings);
  const originalSet = env.game.settings.set.bind(env.game.settings);
  env.game.settings.settings.set(`${__test__.MODULE_ID}.${__test__.UI_LANGUAGE_SETTING}`, {});
  env.game.settings.get = () => {
    throw new Error("boom");
  };
  assert.equal(__test__.getRegisteredSettingValue(__test__.UI_LANGUAGE_SETTING, "fallback"), "fallback");
  env.game.settings.get = originalGet;

  env.game.settings.get = () => ({ token: "other", owner: "other-user", expiresAt: Date.now() + 1000 });
  await assert.rejects(() => __test__.acquireBackupStoreLock({ timeoutMs: 1, retryMs: 0 }), /Timed out/);

  let raced = false;
  env.game.settings.get = (_moduleId, settingKey) => {
    if (settingKey !== __test__.STORE_LOCK_SETTING) return originalGet(_moduleId, settingKey);
    return raced
      ? { token: "other", owner: "other-user", expiresAt: Date.now() + 1000 }
      : { token: null, owner: null, expiresAt: 0 };
  };
  env.game.settings.set = async () => {
    raced = true;
    return null;
  };
  await assert.rejects(() => __test__.acquireBackupStoreLock({ timeoutMs: 1, retryMs: 0 }), /Timed out/);
  env.game.settings.get = originalGet;
  env.game.settings.set = originalSet;

  env.state.createDirectoryErrors.set("worlds/test-world/scbr/boom", new Error("boom"));
  await assert.rejects(() => __test__.ensureStorageDirectoryExists("boom"), /boom/);

  env.state.uploadResult = {};
  env.state.fetchImpl = async () => createResponse({ ok: false, status: 404 });
  await assert.rejects(() => __test__.writeBackupFile(createBackupRecord()), /Failed to write backup file/);
  await assert.rejects(() => __test__.readBackupFile({ documentName: "Scene" }), /invalid/i);
  await assert.rejects(() => __test__.readBackupFile({ path: "Scene.json", documentName: "Scene" }), /invalid/i);

  env.state.fetchImpl = async () => createResponse({ ok: true, json: { backups: [{ id: "backup-1" }] } });
  await assert.rejects(() => __test__.readBackupFile({ path: "Scene.json#backup-1", documentName: "Scene" }), /invalid/i);

  env.state.fetchImpl = async () => createResponse({ ok: true, json: { documentType: "Scene", backups: [createBackupRecord()] } });
  env.state.uploadResult = {};
  await assert.rejects(() => __test__.deleteBackupFile("Scene.json#backup-1"), /Failed to update backup file/);

  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, null);
  assert.deepEqual(__test__.getBackupStore(), { version: __test__.BACKUP_STORAGE_VERSION, backups: [] });

  await __test__.clearBackupStore(__test__.MODULE_ID);
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === __test__.MODULE_ID && entry.settingKey === __test__.STORE_SETTING), true);

  await assert.rejects(() => __test__.unsetLegacyDocumentFlag({ async unsetFlag() { throw new Error("boom"); } }, "scope", "key"), /boom/);

  const sceneWithFallback = createDocument({
    documentName: "Scene",
    flags: {
      "backup-tool": {
        [__test__.LEGACY_SCENE_BACKUP_FLAG]: [{ id: "legacy-scene", data: { foo: 1 } }]
      }
    }
  });
  assert.equal(__test__.getLegacyBackups(sceneWithFallback)[0].id, "legacy-scene");
  assert.equal(__test__.getContextDataset(null), null);
  assert.equal(__test__.getContextDataset({ foo: "bar" }), null);

  assert.throws(() => __test__.buildRestoreData(createDocument(), null), /invalid/i);
  const sanitized = { flags: { [__test__.MODULE_ID]: { temp: true } } };
  __test__.sanitizeFlags(sanitized);
  assert.equal(sanitized.flags, undefined);
  const rebuilt = __test__.buildReconstructionData({ documentName: "Rebuilt", data: { folder: "missing-folder", flags: { [__test__.MODULE_ID]: { temp: true } } } });
  assert.equal(rebuilt.folder, null);
  assert.equal(rebuilt.flags, undefined);

  const promptInput = document.createElement("input");
  env.state.dialogWaitResult = (options) => {
    const dialog = {
      element: document.createElement("div")
    };
    dialog.element.setQuerySelector("#scbr-name-input", promptInput);
    options.render?.(null, dialog);
    return "Prompted";
  };
  assert.equal(await __test__.promptForBackupName(createDocument()), "Prompted");
  assert.equal(promptInput.focused, true);
  assert.equal(promptInput.selected, true);

  const storage = createVirtualStorage();
  storage.write("Actor.json", { documentType: "Actor", backups: [createBackupRecord({ documentType: "Actor", documentId: "actor-1", path: "Actor.json#backup-1" })] });
  env.game.actors = { contents: [], get() { return null; }, documentClass: null };
  await assert.rejects(() => __test__.reconstructDocumentFromBackup({ path: "Actor.json#backup-1", documentType: "Actor" }), /Recovery is not supported/);

  const removalStorage = createVirtualStorage();
  removalStorage.write("Scene.json", { documentType: "Scene", backups: [createBackupRecord()] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [{ id: "backup-1", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#backup-1" }]
  });
  await __test__.removeBackup(createDocument(), "backup-1");
  assert.equal(env.state.notifications.info.some((message) => String(message).includes("removed")), true);

  const unchangedStorage = createVirtualStorage();
  unchangedStorage.write("Scene.json", { documentType: "Scene", backups: [createBackupRecord({ id: "indexed-same" })] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [{ id: "indexed-same", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#indexed-same" }]
  });
  await __test__.migrateLegacyBackups();
  assert.equal(__test__.getAllBackups().some((entry) => entry.id === "indexed-same"), true);
});

test("migration rewrites indexed backups, merges legacy sources, and clears legacy stores", async () => {
  const storage = createVirtualStorage();
  const scene = createDocument({
    id: "scene-1",
    name: "Scene One",
    documentName: "Scene",
    flags: {
      [__test__.MODULE_ID]: {
        [__test__.LEGACY_FLAG]: [{ id: "flag-1", data: { foo: 1 } }]
      }
    }
  });
  env.setCollection("Scene", [scene]);

  const indexed = { id: "indexed-1", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "old-folder/Scene.json#indexed-1" };
  const embedded = createDocument({ id: "unused", documentName: "Scene" });
  void embedded;

  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      indexed,
      { id: "embedded-1", documentId: "scene-2", documentName: "Embedded Scene", documentType: "Scene", createdAt: "2024-01-02T00:00:00.000Z", path: "embedded.json#embedded-1", data: { foo: 2 } }
    ]
  });
  env.state.settingsValues.set(`backup-tool.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupRecord({ id: "legacy-store-1", documentId: "scene-3", documentName: "Legacy Store Scene", path: "legacy.json#legacy-store-1" })]
  });

  storage.write("old-folder/Scene.json", { version: 6, documentType: "Scene", backups: [createBackupRecord({ id: "indexed-1", documentId: "scene-1", documentName: "Scene One", path: "old-folder/Scene.json#indexed-1" })] }, __test__.getLegacyWorldStorageRoot());
  await __test__.migrateLegacyBackups();

  const store = env.state.settingWrites.findLast((entry) => entry.settingKey === __test__.STORE_SETTING && entry.moduleId === __test__.MODULE_ID)?.value;
  assert.equal(Array.isArray(store.backups), true);
  assert.equal(store.backups.some((entry) => entry.id === "indexed-1"), true);
  assert.equal(store.backups.length >= 1, true);
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "backup-tool" && entry.settingKey === __test__.STORE_SETTING), true);
});

const ACTOR_ID = "a1B2c3D4e5F6g7H8";
const ITEM_ID = "i1B2c3D4e5F6g7H8";

function createActorBackupRecord(overrides = {}) {
  return createBackupRecord({
    id: "actor-backup-1",
    name: "Goblin Backup",
    documentId: ACTOR_ID,
    documentName: "Goblin",
    documentType: "Actor",
    createdAt: "2024-01-02T00:00:00.000Z",
    path: "Actor.json#actor-backup-1",
    data: { _id: ACTOR_ID, name: "Goblin", items: [{ _id: ITEM_ID, name: "Scimitar" }], flags: { [__test__.MODULE_ID]: { temp: true } } },
    ...overrides
  });
}

function toIndexEntry({ data: _data, ...record }) {
  return record;
}

function seedActorBackups(storage) {
  const records = [
    createActorBackupRecord(),
    createActorBackupRecord({ id: "actor-backup-0", name: "Older", createdAt: "2024-01-01T00:00:00.000Z", path: "Actor.json#actor-backup-0" })
  ];
  storage.write("Actor.json", { version: 6, documentType: "Actor", backups: records });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: records.map(toIndexEntry)
  });
  return records;
}

test("reconstruct keeps the original id and embedded ids and leaves the backups untouched", async () => {
  const storage = createVirtualStorage();
  const [record] = seedActorBackups(storage);
  const createCalls = [];
  env.setCollection("Actor", [], {
    createResult: async (data, options) => {
      createCalls.push({ data, options });
      return { id: data._id, name: data.name, documentName: "Actor" };
    }
  });

  const created = await __test__.reconstructDocumentFromBackup(toIndexEntry(record));

  assert.equal(created.id, ACTOR_ID);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].options.keepId, true);
  assert.equal(createCalls[0].options.renderSheet, true);
  assert.equal(createCalls[0].data._id, ACTOR_ID);
  assert.equal(createCalls[0].data.items[0]._id, ITEM_ID);
  assert.equal(createCalls[0].data.flags, undefined);
  // No backup is rewritten and the index is not touched: the backups still point to the same id.
  assert.equal(env.state.uploadCalls.length, 0);
  assert.equal(env.state.settingWrites.some((entry) => entry.settingKey === __test__.STORE_SETTING), false);
  assert.deepEqual(__test__.getAllBackups().map((entry) => [entry.id, entry.documentId]), [["actor-backup-1", ACTOR_ID], ["actor-backup-0", ACTOR_ID]]);
  assert.equal(storage.files.get("worlds/test-world/scbr/Actor.json").backups.every((entry) => entry.documentId === ACTOR_ID), true);
  assert.equal(env.state.notifications.info.some((message) => String(message).includes("Goblin")), true);
});

test("reconstruct falls back to a new id when the original id is still taken and moves the backups over", async () => {
  const storage = createVirtualStorage();
  const [record] = seedActorBackups(storage);
  const newId = "n1B2c3D4e5F6g7H8";
  const createCalls = [];
  const getCalls = [];
  env.game.actors = {
    contents: [],
    // A document with invalid source data is only returned when asked for with invalid: true.
    get(id, options) {
      getCalls.push({ id, options });
      return options?.invalid && id === ACTOR_ID ? { id: ACTOR_ID, name: "Broken", documentName: "Actor" } : null;
    },
    documentClass: {
      async create(data, options) {
        createCalls.push({ data, options });
        return { id: newId, name: data.name, documentName: "Actor" };
      }
    }
  };

  const created = await __test__.reconstructDocumentFromBackup(toIndexEntry(record));

  assert.equal(created.id, newId);
  assert.deepEqual(getCalls[0], { id: ACTOR_ID, options: { invalid: true } });
  assert.equal(createCalls[0].options.keepId, false);
  assert.equal(createCalls[0].data._id, undefined);
  assert.equal(createCalls[0].data.items[0]._id, ITEM_ID);
  assert.deepEqual(__test__.getAllBackups().map((entry) => entry.documentId), [newId, newId]);
  const fileBackups = storage.files.get("worlds/test-world/scbr/Actor.json").backups;
  assert.equal(fileBackups.every((entry) => entry.documentId === newId && entry.data._id === newId), true);
});

test("restore asks first and does nothing when the dialog is cancelled", async () => {
  createVirtualStorage();
  const scene = createDocument();
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [toIndexEntry(createBackupRecord())]
  });
  env.state.dialogConfirmResult = false;

  await __test__.restoreBackup(scene, "backup-1");

  assert.equal(env.state.lastDialogConfirmOptions.window.title, "Restore Backup");
  assert.equal(env.state.lastDialogConfirmOptions.yes.label, "Restore");
  assert.equal(env.state.lastDialogConfirmOptions.content.includes("Scene Backup"), true);
  assert.equal(env.state.lastDialogConfirmOptions.content.includes("saved as a backup first"), true);
  assert.equal(scene.lastUpdate, undefined);
  assert.equal(env.state.fetchCalls.length, 0);
  assert.equal(env.state.uploadCalls.length, 0);
});

test("restore saves the current state as a safety backup before it overwrites the document", async () => {
  const storage = createVirtualStorage();
  const order = [];
  const upload = env.state.uploadImpl;
  env.state.uploadImpl = async (...args) => {
    order.push("upload");
    return upload(...args);
  };
  const scene = createDocument({ data: { width: 4000 } });
  const update = scene.update;
  scene.update = async function (...args) {
    order.push("update");
    return update.apply(this, args);
  };
  env.setCollection("Scene", [scene]);
  storage.write("Scene.json", { version: 6, documentType: "Scene", backups: [createBackupRecord({ data: { name: "Scene One", width: 1000 } })] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [toIndexEntry(createBackupRecord())]
  });

  await __test__.restoreBackup(scene, "backup-1");

  assert.deepEqual(order, ["upload", "update"]);
  assert.equal(scene.lastUpdate.updateData.width, 1000);
  const backups = __test__.getBackups(scene);
  assert.equal(backups.length, 2);
  const safety = backups.find((entry) => entry.id !== "backup-1");
  assert.equal(safety.name, "Before restore");
  const stored = storage.files.get("worlds/test-world/scbr/Scene.json").backups.find((entry) => entry.id === safety.id);
  assert.equal(stored.data.width, 4000);
  assert.equal(env.state.notifications.info.at(-1).includes(`The previous state was saved as '${safety.name}'`), true);

  // The safety backup is an ordinary backup: restoring it undoes the restore.
  await __test__.restoreBackup(scene, safety.id);
  assert.equal(scene.lastUpdate.updateData.width, 4000);
});

test("restore skips the safety backup when the world setting is off", async () => {
  const storage = createVirtualStorage();
  env.game.settings.settings.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, {});
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, false);
  const scene = createDocument();
  storage.write("Scene.json", { version: 6, documentType: "Scene", backups: [createBackupRecord()] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [toIndexEntry(createBackupRecord())]
  });

  assert.equal(__test__.isSafetyBackupEnabled(), false);
  await __test__.restoreBackup(scene, "backup-1");

  assert.equal(env.state.lastDialogConfirmOptions.content.includes("turned off in the module settings"), true);
  assert.equal(scene.lastUpdate.updateData._id, "scene-1");
  assert.equal(env.state.uploadCalls.length, 0);
  assert.equal(__test__.getBackups(scene).length, 1);
  assert.equal(env.state.notifications.info.at(-1).includes("previous state"), false);
});

test("a failed safety backup aborts the restore", async () => {
  const storage = createVirtualStorage();
  const scene = createDocument();
  storage.write("Scene.json", { version: 6, documentType: "Scene", backups: [createBackupRecord()] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [toIndexEntry(createBackupRecord())]
  });
  env.state.uploadImpl = async () => ({});

  await assert.rejects(() => __test__.restoreBackup(scene, "backup-1"), /Failed to write backup file/);
  assert.equal(scene.lastUpdate, undefined);
});

function createBackupRecord(overrides = {}) {
  return {
    id: "backup-1",
    name: "Scene Backup",
    documentId: "scene-1",
    documentName: "Scene One",
    documentType: "Scene",
    createdAt: "2024-01-01T00:00:00.000Z",
    coreGeneration: 14,
    path: "Scene.json#backup-1",
    data: { name: "Scene One", flags: {} },
    ...overrides
  };
}