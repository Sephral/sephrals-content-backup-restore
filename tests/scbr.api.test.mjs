import assert from "node:assert/strict";
import test from "node:test";

import { createResponse, createTestEnvironment } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import("../scripts/scbr.js");

const SCENE_ID = "s1B2c3D4e5F6g7H8";
const ACTOR_ID = "a1B2c3D4e5F6g7H8";

function createDocument({ id = SCENE_ID, name = "Scene One", documentName = "Scene", data = {} } = {}) {
  return {
    id,
    name,
    documentName,
    toObject() {
      return structuredClone({ _id: id, name, ...data });
    },
    async update(updateData, options) {
      this.lastUpdate = { updateData, options };
    }
  };
}

function createBackupRecord(overrides = {}) {
  return {
    id: "backup-1",
    name: "Scene Backup",
    documentId: SCENE_ID,
    documentName: "Scene One",
    documentType: "Scene",
    createdAt: "2024-01-01T00:00:00.000Z",
    coreGeneration: 13,
    coreBuild: 351,
    systemId: "dnd5e",
    systemVersion: "5.2.0",
    path: "Scene.json#backup-1",
    data: { name: "Scene One", width: 1000 },
    ...overrides
  };
}

function toIndexEntry({ data: _data, ...record }) {
  return record;
}

function createVirtualStorage() {
  const files = new Map();
  const normalize = (value) => String(value).replace(/\/+/g, "/");

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
    seed(records) {
      const documentType = records[0].documentType;
      files.set(normalize(__test__.getBackupFetchUrl(`${documentType}.json`)), { version: 6, documentType, backups: structuredClone(records) });
      env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, { version: 6, backups: records.map(toIndexEntry) });
    }
  };
}

function resetState() {
  env.state.notifications.info.length = 0;
  env.state.notifications.warn.length = 0;
  env.state.notifications.error.length = 0;
  env.state.fetchCalls.length = 0;
  env.state.fetchResponses.clear();
  env.state.fetchImpl = null;
  env.state.uploadCalls.length = 0;
  env.state.uploadImpl = null;
  env.state.uploadResult = null;
  env.state.settingWrites.length = 0;
  env.state.settingsValues.clear();
  env.game.settings.settings.clear();
  env.state.dialogWaitResult = null;
  env.state.dialogConfirmResult = true;
  env.state.lastDialogWaitOptions = null;
  env.state.lastDialogConfirmOptions = null;
  env.state.localizations.clear();
  __test__.resetModuleTranslationState();
  env.game.release = { generation: 14, build: 361 };
  env.game.system = { id: "dnd5e", version: "5.3.3" };
  env.game.user.isGM = true;
  for (const config of __test__.SUPPORTED_DOCUMENTS) env.setCollection(config.documentName, []);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_LOCK_SETTING}`, { token: null, owner: null, expiresAt: 0, acquiredAt: null });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, { version: __test__.BACKUP_STORAGE_VERSION, backups: [] });
}

test.beforeEach(resetState);
test.after(() => env.cleanup());

test("new backups record the core and system versions, and the index keeps them", () => {
  const payload = __test__.buildBackupPayload(createDocument(), "Snapshot");
  assert.equal(payload.coreGeneration, 14);
  assert.equal(payload.coreBuild, 361);
  assert.equal(payload.systemId, "dnd5e");
  assert.equal(payload.systemVersion, "5.3.3");

  const index = __test__.normalizeBackupIndex({ ...payload, path: "Scene.json#x" });
  assert.deepEqual([index.coreGeneration, index.coreBuild, index.systemId, index.systemVersion], [14, 361, "dnd5e", "5.3.3"]);
  const stored = __test__.normalizeBackup({ ...payload, path: "Scene.json#x" });
  assert.deepEqual([stored.coreGeneration, stored.coreBuild, stored.systemId, stored.systemVersion], [14, 361, "dnd5e", "5.3.3"]);

  // Older backups keep what they had and leave the rest empty.
  const legacy = __test__.normalizeBackupIndex({ id: "old", coreGeneration: 13, path: "Scene.json#old" });
  assert.deepEqual([legacy.coreGeneration, legacy.coreBuild, legacy.systemId, legacy.systemVersion], [13, null, null, null]);
});

test("the version warning compares core generation, system id and system version", () => {
  const world = __test__.getWorldEnvironment();
  assert.equal(__test__.formatEnvironmentLabel(createBackupRecord(), { build: true }), "Foundry 13.351 / dnd5e 5.2.0");
  assert.equal(__test__.formatEnvironmentLabel({}), "");

  assert.equal(
    __test__.getCompatibilityWarning(createBackupRecord(), world),
    "This backup was made with Foundry 13 / dnd5e 5.2.0, this world runs Foundry 14 / dnd5e 5.3.3. Foundry migrates the data, but check the result."
  );
  assert.equal(__test__.getCompatibilityWarning(createBackupRecord({ coreGeneration: 14, coreBuild: 351, systemVersion: "5.3.3" }), world), null);
  assert.match(__test__.getCompatibilityWarning(createBackupRecord({ coreGeneration: 14 }), world), /dnd5e 5\.2\.0, this world runs Foundry 14 \/ dnd5e 5\.3\.3/);
  assert.match(__test__.getCompatibilityWarning(createBackupRecord({ coreGeneration: 14, systemId: "pf2e", systemVersion: "7.0.0" }), world), /pf2e 7\.0\.0, this world runs Foundry 14 \/ dnd5e 5\.3\.3/);

  // Older backups only stored the generation: the system is left out on both sides.
  assert.equal(
    __test__.getCompatibilityWarning({ coreGeneration: 13 }, world),
    "This backup was made with Foundry 13, this world runs Foundry 14. Foundry migrates the data, but check the result."
  );
  assert.equal(__test__.getCompatibilityWarning({ coreGeneration: 14 }, world), null);
  assert.equal(__test__.getCompatibilityWarning({}, world), null);
});

test("the restore confirmation shows the version warning before anything is read", async () => {
  createVirtualStorage().seed([createBackupRecord()]);
  const scene = createDocument();
  env.setCollection("Scene", [scene]);
  env.state.dialogConfirmResult = false;

  assert.equal(await __test__.restoreBackup(scene, "backup-1"), false);
  const content = env.state.lastDialogConfirmOptions.content;
  assert.equal(content.includes("scbr-compat-warning"), true);
  assert.equal(content.includes("made with Foundry 13 / dnd5e 5.2.0, this world runs Foundry 14 / dnd5e 5.3.3"), true);
  assert.equal(env.state.fetchCalls.length, 0);
  assert.equal(scene.lastUpdate, undefined);

  createVirtualStorage().seed([createBackupRecord({ coreGeneration: 14, systemVersion: "5.3.3" })]);
  await __test__.restoreBackup(scene, "backup-1");
  assert.equal(env.state.lastDialogConfirmOptions.content.includes("scbr-compat-warning"), false);
});

test("reconstruct reports a version difference as a notification", async () => {
  createVirtualStorage().seed([createBackupRecord({ documentId: ACTOR_ID, documentName: "Goblin", documentType: "Actor", path: "Actor.json#backup-1", data: { _id: ACTOR_ID, name: "Goblin" } })]);
  env.setCollection("Actor", [], { createResult: async (data) => ({ id: data._id, name: data.name, documentName: "Actor" }) });

  await __test__.reconstructDocumentFromBackup({ path: "Actor.json#backup-1", documentType: "Actor" });
  assert.equal(env.state.notifications.warn.length, 1);
  assert.match(env.state.notifications.warn[0], /made with Foundry 13 \/ dnd5e 5\.2\.0/);
  assert.equal(env.state.notifications.info.some((message) => message.includes("Goblin")), true);
});

test("backup rows show the recorded versions as a tooltip", () => {
  const rows = __test__.buildBackupRows([
    { backup: toIndexEntry(createBackupRecord()), document: null },
    { backup: toIndexEntry(createBackupRecord({ id: "backup-2", coreGeneration: null, coreBuild: null, systemId: null, systemVersion: null })), document: null }
  ]);
  assert.equal(rows.includes('title="Made with Foundry 13.351 / dnd5e 5.2.0"'), true);
  assert.equal((rows.match(/class="scbr-backup-main" title=/g) ?? []).length, 1);
});

test("init exposes the API on the module", async () => {
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/en.json", {});
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/de.json", {});
  await env.hooks.trigger("init");

  const api = env.game.modules.get(__test__.MODULE_ID).api;
  assert.deepEqual(Object.keys(api).sort(), ["createBackup", "listBackups", "reconstruct", "restoreBackup", "runSelfTest", "saveDebugFile"]);
});

test("API createBackup and listBackups work without a dialog", async () => {
  const storage = createVirtualStorage();
  const scene = createDocument();
  const other = createDocument({ id: "o1B2c3D4e5F6g7H8", name: "Other Scene" });
  env.setCollection("Scene", [scene, other]);
  const api = __test__.createApi();

  const entry = await api.createBackup(scene);
  assert.equal(entry.name, "Scene One");
  assert.equal(entry.documentId, SCENE_ID);
  assert.equal(entry.systemVersion, "5.3.3");
  assert.equal(entry.data, undefined);
  assert.equal(env.state.lastDialogWaitOptions, null);
  assert.equal(env.state.notifications.info.length, 0);
  assert.equal(storage.files.get("worlds/test-world/scbr/Scene.json").backups[0].data.name, "Scene One");

  const named = await api.createBackup(other, "Before session");
  assert.equal(named.name, "Before session");

  assert.deepEqual(api.listBackups(scene).map((backup) => backup.id), [entry.id]);
  assert.deepEqual(api.listBackups().map((backup) => backup.id).sort(), [entry.id, named.id].sort());
});

test("API restoreBackup can skip the dialog and still saves the safety backup", async () => {
  const storage = createVirtualStorage();
  storage.seed([createBackupRecord()]);
  const scene = createDocument({ data: { width: 4000 } });
  env.setCollection("Scene", [scene]);
  const api = __test__.createApi();

  assert.equal(await api.restoreBackup(scene, "backup-1", { confirm: false }), true);
  assert.equal(env.state.lastDialogConfirmOptions, null);
  assert.equal(scene.lastUpdate.updateData.width, 1000);
  assert.equal(api.listBackups(scene).length, 2);
  assert.equal(env.state.notifications.warn.length, 1);
  assert.match(env.state.notifications.warn[0], /Foundry 13 \/ dnd5e 5\.2\.0/);

  env.state.dialogConfirmResult = false;
  scene.lastUpdate = undefined;
  assert.equal(await api.restoreBackup(scene, "backup-1"), false);
  assert.equal(env.state.lastDialogConfirmOptions.window.title, "Restore Backup");
  assert.equal(scene.lastUpdate, undefined);

  await assert.rejects(() => api.restoreBackup(scene, "missing"), /No backup with the id 'missing' was found/);
});

test("API reconstruct recreates deleted documents only", async () => {
  const storage = createVirtualStorage();
  storage.seed([createBackupRecord({ documentId: ACTOR_ID, documentName: "Goblin", documentType: "Actor", path: "Actor.json#backup-1", data: { _id: ACTOR_ID, name: "Goblin" } })]);
  env.setCollection("Actor", [], { createResult: async (data) => ({ id: data._id, name: data.name, documentName: "Actor" }) });
  const api = __test__.createApi();

  const created = await api.reconstruct("backup-1");
  assert.equal(created.id, ACTOR_ID);
  await assert.rejects(() => api.reconstruct("missing"), /No backup with the id 'missing' was found/);

  env.setCollection("Actor", [createDocument({ id: ACTOR_ID, name: "Goblin", documentName: "Actor" })]);
  await assert.rejects(() => api.reconstruct("backup-1"), /'Goblin' still exists/);
});

test("API refuses players and documents outside the world collections", async () => {
  const scene = createDocument();
  env.setCollection("Scene", [scene]);
  const api = __test__.createApi();

  // A compendium or synthetic copy has the same id but is not the world document.
  const copy = createDocument();
  await assert.rejects(() => api.createBackup(copy), /only work for scenes/);
  assert.throws(() => api.listBackups(copy), /only work for scenes/);
  await assert.rejects(() => api.createBackup({ id: "x", documentName: "User" }), /only work for scenes/);

  env.game.user.isGM = false;
  await assert.rejects(() => api.createBackup(scene), /Only a GM/);
  assert.throws(() => api.listBackups(), /Only a GM/);
  await assert.rejects(() => api.restoreBackup(scene, "backup-1"), /Only a GM/);
  await assert.rejects(() => api.reconstruct("backup-1"), /Only a GM/);
  assert.equal(env.state.uploadCalls.length, 0);
});
