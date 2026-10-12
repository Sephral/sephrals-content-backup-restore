import assert from "node:assert/strict";
import test from "node:test";

import { createResponse, createTestEnvironment, importModule } from "./helpers/test-helpers.mjs";

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

test("storage helpers acquire locks, write files, read backups, and delete entries", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");

  const roots = __test__.getStorageRoots();
  const worldUrl = __test__.getBackupFetchUrl("Scene.json", roots[0]);
  const legacyUrl = __test__.getBackupFetchUrl("Scene.json", roots[1]);
  const moduleUrl = __test__.getBackupFetchUrl("Scene.json", roots[2]);
  const existing = createBackupRecord({ id: "existing", path: "Scene.json#existing", createdAt: "2024-01-02T00:00:00.000Z" });

  env.state.fetchImpl = async (url) => {
    if (url.startsWith(worldUrl)) return createResponse({ ok: false, status: 404 });
    if (url.startsWith(legacyUrl)) return createResponse({ ok: false, status: 404 });
    if (url.startsWith(moduleUrl)) return createResponse({ ok: true, json: { version: 6, documentType: "Scene", backups: [existing] } });
    return createResponse({ ok: false, status: 404 });
  };

  const token = await __test__.acquireBackupStoreLock({ timeoutMs: 5, retryMs: 0 });
  assert.equal(token.startsWith("gm-user-random-"), true);
  await __test__.releaseBackupStoreLock(token);
  assert.equal(env.state.settingWrites.at(-1).settingKey, __test__.STORE_LOCK_SETTING);

  const stored = await __test__.writeBackupFile(createBackupRecord());
  assert.equal(stored.id, "backup-1");
  assert.equal(env.state.createDirectoryCalls.length > 0, true);
  assert.equal(env.state.uploadCalls.length, 1);
  const uploadPayload = JSON.parse(await env.state.uploadCalls[0].file.text());
  assert.equal(uploadPayload.backups.length, 2);

  env.state.fetchImpl = async (url) => {
    if (url.includes("Scene.json")) {
      return createResponse({
        ok: true,
        json: {
          version: 6,
          documentType: "Scene",
          backups: [stored, existing]
        }
      });
    }
    return createResponse({ ok: false, status: 404 });
  };

  const loaded = await __test__.readBackupFile({ path: "Scene.json#backup-1", documentName: "Scene One" }, { includeSource: true });
  assert.equal(loaded.backup.id, "backup-1");
  assert.equal(loaded.sourceRoot, roots[0]);

  env.state.uploadCalls.length = 0;
  const deletion = await __test__.deleteBackupFile("Scene.json#backup-1");
  assert.deepEqual(deletion, { deleted: true, unsupported: false });
  const deletePayload = JSON.parse(await env.state.uploadCalls[0].file.text());
  assert.equal(deletePayload.backups.length, 1);

  env.cleanup();
});

test("storage helpers normalize stores, collect file indexes, clear stores, and swallow inactive legacy flags", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");

  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      { id: "one", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#one" }
    ]
  });
  assert.equal(__test__.getBackupStore().backups.length, 1);
  assert.equal(__test__.getAllBackups().length, 1);

  env.state.settingsValues.set(`backup-tool.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupRecord({ id: "legacy-store" })]
  });
  assert.equal(__test__.getLegacyBackupStore("backup-tool").length, 1);

  env.state.fetchImpl = async (url) => {
    if (url.includes("Scene.json")) {
      return createResponse({ ok: true, json: { backups: [createBackupRecord({ id: "from-file" })] } });
    }
    return createResponse({ ok: false, status: 404 });
  };
  const collected = await __test__.collectBackupsFromTypeFiles();
  assert.equal(collected.length, 1);
  assert.equal(collected[0].path, "Scene.json#from-file");

  await __test__.clearBackupStore("backup-tool");
  assert.equal(env.state.settingWrites.at(-1).moduleId, "backup-tool");

  const document = {
    async unsetFlag() {
      throw new Error("scope is not valid or not currently active");
    }
  };
  await __test__.unsetLegacyDocumentFlag(document, "backup-tool", __test__.LEGACY_FLAG);

  env.cleanup();
});

test("the index rescan reads only listed or indexed type files and reads every file without a listing", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");
  const root = __test__.getWorldStorageRoot();
  const files = new Map([
    [`${root}/Scene.json`, { version: 6, documentType: "Scene", backups: [createBackupRecord()] }],
    // On disk but unknown to the index: the listing still finds it, so the rescan keeps healing the index.
    [`${root}/Macro.json`, { version: 6, documentType: "Macro", backups: [createBackupRecord({ id: "macro-1", documentType: "Macro", documentId: "macro-doc", path: "Macro.json#macro-1" })] }]
  ]);
  env.state.fetchImpl = async (url) => {
    const clean = url.split("?")[0];
    return files.has(clean) ? createResponse({ ok: true, json: structuredClone(files.get(clean)) }) : createResponse({ ok: false, status: 404 });
  };
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [{ id: "item-1", documentId: "item-doc", documentName: "Item", documentType: "Item", createdAt: "2024-01-01T00:00:00.000Z", path: "Item.json#item-1" }]
  });
  env.state.browseImpl = async () => ({ dirs: [], files: [`${root}/Scene.json`, `${root}/Macro.json`] });
  const fetchedFiles = () => env.state.fetchCalls.map(({ url }) => url.split("?")[0].split("/").pop()).sort();

  const collected = await __test__.collectBackupsFromTypeFiles([{ id: "actor-1", documentType: "Actor", path: "Actor.json#actor-1" }]);
  assert.deepEqual(env.state.browseCalls.map(({ source, target }) => ({ source, target })), [{ source: "data", target: root }]);
  // Listed files plus every type the index or the caller mentions; the other types are not probed.
  assert.deepEqual(fetchedFiles(), ["Actor.json", "Item.json", "Macro.json", "Scene.json"]);
  assert.deepEqual(collected.map((entry) => entry.id).sort(), ["backup-1", "macro-1"]);

  // Without a usable listing every type file is read as before.
  for (const browseImpl of [async () => { throw new Error("Directory does not exist"); }, async () => ({})]) {
    env.state.fetchCalls.length = 0;
    env.state.browseImpl = browseImpl;
    const all = await __test__.collectBackupsFromTypeFiles();
    assert.equal(env.state.fetchCalls.length, __test__.SUPPORTED_DOCUMENTS.length);
    assert.deepEqual(all.map((entry) => entry.id).sort(), ["backup-1", "macro-1"]);
  }

  // A full save after a write only touches files that exist or are indexed.
  env.state.fetchCalls.length = 0;
  env.state.browseImpl = async () => ({ dirs: [], files: [`${root}/Scene.json`, `${root}/Macro.json`] });
  await __test__.saveBackupStore(__test__.getAllBackups());
  assert.deepEqual(fetchedFiles(), ["Item.json", "Macro.json", "Scene.json"]);
  assert.deepEqual(__test__.getAllBackups().map((entry) => entry.id).sort(), ["backup-1", "macro-1"]);

  env.cleanup();
});

test("backup store queries and store writes respect document identity", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");
  const document = { id: "scene-1", documentName: "Scene" };
  const another = { id: "scene-2", documentName: "Scene" };

  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      { id: "scene-1-a", documentId: "scene-1", documentName: "One", documentType: "Scene", createdAt: "2024-01-02T00:00:00.000Z", path: "Scene.json#scene-1-a" },
      { id: "scene-2-a", documentId: "scene-2", documentName: "Two", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#scene-2-a" }
    ]
  });

  env.state.fetchImpl = async () => createResponse({ ok: false, status: 404 });

  assert.equal(__test__.getBackups(document).length, 1);
  assert.equal(__test__.getBackupById(document, "scene-1-a")?.id, "scene-1-a");
  assert.equal(__test__.getDocumentBackupSummary(document)?.latest.id, "scene-1-a");

  await __test__.setBackups(document, [
    { id: "scene-1-b", documentId: "scene-1", documentName: "One", documentType: "Scene", createdAt: "2024-01-03T00:00:00.000Z", path: "Scene.json#scene-1-b" }
  ]);

  const writtenStore = env.state.settingWrites.find((entry) => entry.settingKey === __test__.STORE_SETTING)?.value;
  assert.equal(writtenStore.backups.length, 2);
  assert.equal(writtenStore.backups.some((entry) => entry.id === "scene-2-a"), true);
  assert.equal(writtenStore.backups.some((entry) => entry.id === "scene-1-b"), true);
  assert.equal(__test__.getBackupById(another, "scene-2-a")?.id, "scene-2-a");

  env.cleanup();
});