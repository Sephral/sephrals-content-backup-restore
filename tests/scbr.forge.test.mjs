import assert from "node:assert/strict";
import test from "node:test";

import { createResponse, createTestEnvironment, importModule } from "./helpers/test-helpers.mjs";

const ASSET_BASE = "https://assets.forge-vtt.com/user123/";
const FORGE_ROOT = "sephrals-content-backup-restore/test-world";

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

function createDocument({ id = "scene-1", name = "Scene One", documentName = "Scene" } = {}) {
  return {
    id,
    name,
    documentName,
    flags: {},
    toObject() {
      return { _id: id, name, flags: {} };
    },
    async update(updateData, options) {
      this.lastUpdate = { updateData, options };
    },
    async unsetFlag() {}
  };
}

// Fake Assets Library: uploads answer with absolute URLs, fetch serves files by URL (query string ignored).
function createForgeStorage(env, { uploadUrl = (target, name) => `${ASSET_BASE}${target}/${name}` } = {}) {
  const files = new Map();

  env.state.fetchImpl = async (url) => {
    const clean = url.split("?")[0];
    if (!files.has(clean)) return createResponse({ ok: false, status: 404 });
    return createResponse({ ok: true, json: structuredClone(files.get(clean)) });
  };

  env.state.uploadImpl = async (source, target, file) => {
    const url = uploadUrl(target, file.name, source);
    files.set(url, JSON.parse(await file.text()));
    return { status: "success", path: url };
  };

  return files;
}

async function setup() {
  const env = createTestEnvironment();
  env.enableForge();
  const { __test__ } = await importModule("scripts/scbr.js");
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_LOCK_SETTING}`, { token: null, owner: null, expiresAt: 0, acquiredAt: null });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, { version: __test__.BACKUP_STORAGE_VERSION, backups: [] });
  return { env, __test__ };
}

function silenceWarnings(t) {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  return warnings;
}

test("detects The Forge only when ForgeVTT.usingTheForge is true and leaves paths unchanged elsewhere", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");

  try {
    assert.equal(__test__.isUsingTheForge(), false);
    assert.equal(__test__.getStorageSource(), "data");
    assert.equal(__test__.getWorldStorageRoot(), "worlds/test-world/scbr");
    assert.deepEqual(__test__.getStorageRoots(), [
      "worlds/test-world/scbr",
      "worlds/test-world/sephrals-content-backup-restore",
      "modules/sephrals-content-backup-restore/storage"
    ]);

    globalThis.ForgeVTT = { usingTheForge: false };
    assert.equal(__test__.isUsingTheForge(), false);

    env.enableForge();
    assert.equal(__test__.isUsingTheForge(), true);
    assert.equal(__test__.getStorageSource(), "forgevtt");
    assert.equal(__test__.getWorldStorageRoot(), FORGE_ROOT);
    assert.deepEqual(__test__.getStorageRoots(), [
      FORGE_ROOT,
      "worlds/test-world/scbr",
      "worlds/test-world/sephrals-content-backup-restore",
      "modules/sephrals-content-backup-restore/storage"
    ]);
    assert.equal(__test__.normalizeStoragePath(`${FORGE_ROOT}/Scene.json#x`), "Scene.json#x");
    assert.equal(await __test__.getForgeAssetUrl(`${FORGE_ROOT}/Scene.json`), `${ASSET_BASE}${FORGE_ROOT}/Scene.json`);
    assert.equal(__test__.appendCacheBuster("https://x.test/a.json?v=1").startsWith("https://x.test/a.json?v=1&ts="), true);
  } finally {
    env.cleanup();
  }

  assert.equal(globalThis.ForgeVTT, undefined);
  assert.equal(globalThis.ForgeAPI, undefined);
});

test("creates the Forge folder with one forgevtt call and ignores its errors", async () => {
  const { env, __test__ } = await setup();

  try {
    await __test__.ensureStorageDirectoryExists("");
    assert.deepEqual(env.state.createDirectoryCalls.map(({ source, target }) => ({ source, target })), [{ source: "forgevtt", target: FORGE_ROOT }]);

    env.state.createDirectoryErrors.set(`${FORGE_ROOT}/nested`, new Error("EEXIST or anything else"));
    await __test__.ensureStorageDirectoryExists("nested");
    assert.equal(env.state.createDirectoryCalls.length, 2);
  } finally {
    env.cleanup();
  }
});

test("writes to the Assets Library and stores the absolute URL in the index, not in the payload file", async () => {
  const { env, __test__ } = await setup();
  const files = createForgeStorage(env);
  const scene = createDocument();
  env.setCollection("Scene", [scene]);
  env.state.dialogWaitResult = "Snapshot";

  try {
    await __test__.createBackup(scene);

    const fileUrl = `${ASSET_BASE}${FORGE_ROOT}/Scene.json`;
    assert.deepEqual(env.state.uploadCalls.map(({ source, target }) => ({ source, target })), [{ source: "forgevtt", target: FORGE_ROOT }]);
    assert.equal(files.has(fileUrl), true);
    assert.equal(files.get(fileUrl).backups[0].url, undefined);

    const [indexed] = __test__.getAllBackups();
    assert.equal(indexed.name, "Snapshot");
    assert.equal(indexed.path, `Scene.json#${indexed.id}`);
    assert.equal(indexed.url, fileUrl);
    assert.equal(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`).backups[0].url, fileUrl);

    env.state.fetchCalls.length = 0;
    await __test__.restoreBackup(scene, indexed.id);
    assert.equal(scene.lastUpdate.updateData._id, "scene-1");
    assert.equal(env.state.fetchCalls.length, 1);
    assert.equal(env.state.fetchCalls[0].url.startsWith(`${fileUrl}?ts=`), true);
  } finally {
    env.cleanup();
  }
});

test("reads prefer the stored URL, even when it differs from the computed Assets Library URL", async () => {
  const { env, __test__ } = await setup();
  const storedUrl = "https://assets.forge-vtt.com/other-owner/sephrals-content-backup-restore/test-world/Scene.json";
  const files = createForgeStorage(env);
  files.set(storedUrl, { version: 6, documentType: "Scene", backups: [createBackupRecord()] });

  try {
    const loaded = await __test__.readBackupFile({ path: "Scene.json#backup-1", url: storedUrl }, { includeSource: true });
    assert.equal(loaded.backup.id, "backup-1");
    assert.equal(loaded.backup.url, storedUrl);
    assert.equal(loaded.sourceRoot, FORGE_ROOT);
    assert.equal(env.state.fetchCalls.length, 1);
    assert.equal(env.state.fetchCalls[0].url.startsWith(`${storedUrl}?ts=`), true);
  } finally {
    env.cleanup();
  }
});

test("legacy entries without a URL try the computed Forge URL first and the relative path last", async () => {
  const { env, __test__ } = await setup();
  const files = createForgeStorage(env);
  const relativePath = "worlds/test-world/scbr/Scene.json";

  try {
    const candidates = await __test__.getStorageFileCandidates("Scene.json");
    assert.deepEqual(candidates.map(({ url }) => url), [
      `${ASSET_BASE}${FORGE_ROOT}/Scene.json`,
      `${FORGE_ROOT}/Scene.json`,
      `${ASSET_BASE}${relativePath}`,
      relativePath,
      `${ASSET_BASE}worlds/test-world/sephrals-content-backup-restore/Scene.json`,
      "worlds/test-world/sephrals-content-backup-restore/Scene.json",
      `${ASSET_BASE}modules/sephrals-content-backup-restore/storage/Scene.json`,
      "modules/sephrals-content-backup-restore/storage/Scene.json"
    ]);

    files.set(`${ASSET_BASE}${relativePath}`, { version: 6, documentType: "Scene", backups: [createBackupRecord()] });
    const computed = await __test__.readBackupFile({ path: "Scene.json#backup-1" }, { includeSource: true });
    assert.equal(computed.sourceRoot, "worlds/test-world/scbr");
    assert.equal(computed.sourceUrl, `${ASSET_BASE}${relativePath}`);
    assert.equal(computed.backup.url, undefined);

    files.clear();
    files.set(relativePath, { version: 6, documentType: "Scene", backups: [createBackupRecord()] });
    const relative = await __test__.readBackupFile({ path: "Scene.json#backup-1" }, { includeSource: true });
    assert.equal(relative.sourceUrl, relativePath);
  } finally {
    env.cleanup();
  }
});

test("migration re-homes legacy data files into the Assets Library and records the URL", async () => {
  const { env, __test__ } = await setup();
  const files = createForgeStorage(env);
  const legacyUrl = `${ASSET_BASE}worlds/test-world/scbr/Scene.json`;
  files.set(legacyUrl, {
    version: 6,
    documentType: "Scene",
    backups: [createBackupRecord(), createBackupRecord({ id: "backup-2", documentId: "scene-2", path: "Scene.json#backup-2" })]
  });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      { id: "backup-1", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#backup-1" },
      { id: "backup-2", documentId: "scene-2", documentName: "Scene Two", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#backup-2" }
    ]
  });

  try {
    await __test__.migrateLegacyBackups();

    const forgeUrl = `${ASSET_BASE}${FORGE_ROOT}/Scene.json`;
    assert.deepEqual(files.get(forgeUrl).backups.map((entry) => entry.id).sort(), ["backup-1", "backup-2"]);
    // The legacy file is rewritten without the re-homed entry (no client-side delete exists).
    assert.equal(files.get(legacyUrl).backups.some((entry) => entry.id === "backup-1"), false);
    assert.equal(env.state.uploadCalls.every(({ source }) => source === "forgevtt"), true);
    assert.equal(env.state.uploadCalls.some(({ target }) => target === "worlds/test-world/scbr"), true);

    const index = __test__.getAllBackups();
    assert.equal(index.length, 2);
    assert.equal(index.every((entry) => entry.url === forgeUrl), true);

    // Second start: everything already lives in the Forge root, nothing is rewritten.
    env.state.uploadCalls.length = 0;
    await __test__.migrateLegacyBackups();
    assert.equal(env.state.uploadCalls.length, 0);
  } finally {
    env.cleanup();
  }
});

test("a failing legacy cleanup on The Forge does not abort the migration", async (t) => {
  const { env, __test__ } = await setup();
  const warnings = silenceWarnings(t);
  const files = createForgeStorage(env);
  const legacyUrl = `${ASSET_BASE}worlds/test-world/sephrals-content-backup-restore/Scene.json`;
  files.set(legacyUrl, { version: 6, documentType: "Scene", backups: [createBackupRecord()] });
  const upload = env.state.uploadImpl;
  env.state.uploadImpl = async (source, target, file, ...rest) => {
    if (target.startsWith("worlds/")) throw new Error("not writable");
    return upload(source, target, file, ...rest);
  };
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [{ id: "backup-1", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#backup-1" }]
  });

  try {
    await __test__.migrateLegacyBackups();
    assert.equal(__test__.getAllBackups()[0].url, `${ASSET_BASE}${FORGE_ROOT}/Scene.json`);
    assert.equal(warnings.length > 0, true);
  } finally {
    env.cleanup();
  }
});

test("delete rewrites the Assets Library file through the stored URL", async () => {
  const { env, __test__ } = await setup();
  const storedUrl = `${ASSET_BASE}${FORGE_ROOT}/Scene.json`;
  const files = createForgeStorage(env);
  files.set(storedUrl, { version: 6, documentType: "Scene", backups: [createBackupRecord(), createBackupRecord({ id: "backup-2", path: "Scene.json#backup-2" })] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [
      { id: "backup-1", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-02T00:00:00.000Z", path: "Scene.json#backup-1", url: storedUrl },
      { id: "backup-2", documentId: "scene-1", documentName: "Scene One", documentType: "Scene", createdAt: "2024-01-01T00:00:00.000Z", path: "Scene.json#backup-2", url: storedUrl }
    ]
  });

  try {
    await __test__.removeBackup(createDocument(), "backup-1");
    assert.deepEqual(files.get(storedUrl).backups.map((entry) => entry.id), ["backup-2"]);
    assert.deepEqual(env.state.uploadCalls.map(({ source, target }) => ({ source, target })), [{ source: "forgevtt", target: FORGE_ROOT }]);
    assert.deepEqual(__test__.getAllBackups().map((entry) => [entry.id, entry.url]), [["backup-2", storedUrl]]);
  } finally {
    env.cleanup();
  }
});

test("a renamed upload URL wins over the stored one within the session", async () => {
  const { env, __test__ } = await setup();
  let revision = 0;
  const files = createForgeStorage(env, { uploadUrl: (target, name) => `${ASSET_BASE}${target}/r${++revision}-${name}` });
  const storedUrl = `${ASSET_BASE}${FORGE_ROOT}/Scene.json`;
  files.set(storedUrl, { version: 6, documentType: "Scene", backups: [createBackupRecord()] });

  try {
    const written = await __test__.writeBackupFile(createBackupRecord({ id: "backup-2", path: "Scene.json#backup-2", url: storedUrl }));
    assert.equal(written.url, `${ASSET_BASE}${FORGE_ROOT}/r1-Scene.json`);
    assert.equal(files.get(written.url).backups.length, 2);

    const collected = await __test__.collectBackupsFromTypeFiles();
    assert.deepEqual(collected.map((entry) => entry.url), [written.url, written.url]);
  } finally {
    env.cleanup();
  }
});

test("an unreadable stored URL aborts writes instead of overwriting, unknown URLs are skipped", async (t) => {
  const { env, __test__ } = await setup();
  silenceWarnings(t);
  const storedUrl = `${ASSET_BASE}${FORGE_ROOT}/Scene.json`;

  try {
    env.state.fetchImpl = async (url) => {
      if (url.startsWith(storedUrl)) throw new TypeError("Failed to fetch");
      return createResponse({ ok: false, status: 404 });
    };
    await assert.rejects(() => __test__.writeBackupFile(createBackupRecord({ url: storedUrl })), /Failed to fetch/);
    assert.equal(env.state.uploadCalls.length, 0);

    // Without a stored URL the computed URL is only a guess: a network error there just moves on.
    env.state.fetchImpl = async (url) => {
      if (url.startsWith(ASSET_BASE)) throw new TypeError("CORS");
      return createResponse({ ok: false, status: 404 });
    };
    await __test__.writeBackupFile(createBackupRecord());
    assert.deepEqual(env.state.uploadCalls.map(({ source, target }) => ({ source, target })), [{ source: "forgevtt", target: FORGE_ROOT }]);
  } finally {
    env.cleanup();
  }
});

test("off The Forge, deleting from a legacy root rewrites that root with source data", async () => {
  const env = createTestEnvironment();
  const { __test__ } = await importModule("scripts/scbr.js");
  const legacyRoot = __test__.getLegacyWorldStorageRoot();
  const files = new Map([[`${legacyRoot}/Scene.json`, { version: 6, documentType: "Scene", backups: [createBackupRecord(), createBackupRecord({ id: "backup-2" })] }]]);
  env.state.fetchImpl = async (url) => {
    const clean = url.split("?")[0];
    return files.has(clean) ? createResponse({ ok: true, json: structuredClone(files.get(clean)) }) : createResponse({ ok: false, status: 404 });
  };
  env.state.uploadImpl = async (_source, target, file) => {
    files.set(`${target}/${file.name}`, JSON.parse(await file.text()));
    return { path: `${target}/${file.name}` };
  };

  try {
    const result = await __test__.deleteBackupFile("Scene.json#backup-1", { storageRoots: [legacyRoot] });
    assert.deepEqual(result, { deleted: true, unsupported: false });
    assert.deepEqual(env.state.uploadCalls.map(({ source, target }) => ({ source, target })), [{ source: "data", target: legacyRoot }]);
    assert.deepEqual(files.get(`${legacyRoot}/Scene.json`).backups.map((entry) => entry.id), ["backup-2"]);
    assert.equal(files.has("worlds/test-world/scbr/Scene.json"), false);
    assert.equal(env.state.createDirectoryCalls.every(({ source }) => source === "data"), true);

    const written = await __test__.writeBackupFile(createBackupRecord({ id: "backup-3", path: "Scene.json#backup-3" }));
    assert.equal(written.url, undefined);
    assert.equal(__test__.normalizeBackupIndex(written).url, undefined);
  } finally {
    env.cleanup();
  }
});
