const MODULE_ID = "sephrals-content-backup-restore";
const LEGACY_MODULE_IDS = [["backup", "tool"].join("-")];
const STORE_SETTING = "backupStore";
const STORE_LOCK_SETTING = "backupStoreLock";
const UI_LANGUAGE_SETTING = "uiLanguage";
const UI_THEME_SETTING = "uiTheme";
const LEGACY_FLAG = "documentBackups";
const LEGACY_SCENE_BACKUP_FLAG = "sceneBackup";
const BACKUP_STORAGE_VERSION = 6;
const SUPPORTED_UI_LANGUAGES = Object.freeze(["en", "de"]);
const DEFAULT_UI_LANGUAGE = "en";
const MODULE_TRANSLATION_CACHE = new Map();
let MODULE_TRANSLATION_LOAD = null;
const LEGACY_STORAGE_ROOT = `modules/${MODULE_ID}/storage`;
const WORLD_STORAGE_ROOT = "scbr";
const BACKUP_LOCK_TIMEOUT_MS = 8000;
const BACKUP_LOCK_RETRY_MS = 120;

const SUPPORTED_DOCUMENTS = [
  { documentName: "Scene", getCollection: () => game.scenes },
  { documentName: "Actor", getCollection: () => game.actors },
  { documentName: "Item", getCollection: () => game.items },
  { documentName: "JournalEntry", getCollection: () => game.journal },
  { documentName: "RollTable", getCollection: () => game.tables },
  { documentName: "Cards", getCollection: () => game.cards },
  { documentName: "Playlist", getCollection: () => game.playlists },
  { documentName: "Macro", getCollection: () => game.macros },
  { documentName: "Combat", getCollection: () => game.combats }
];

function localize(key, fallback, languageOverride) {
  const override = MODULE_TRANSLATION_CACHE.get(getModuleLanguage(languageOverride))?.[key];
  if (override) return override;
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function format(key, data, fallback, languageOverride) {
  const override = MODULE_TRANSLATION_CACHE.get(getModuleLanguage(languageOverride))?.[key];
  if (override) return interpolateTemplate(override, data);
  const value = game.i18n.format(key, data);
  return value === key ? fallback : value;
}

function interpolateTemplate(template, data={}) {
  return String(template ?? "").replace(/\{([^}]+)\}/g, (_match, field) => {
    const replacement = data[field];
    return replacement === undefined || replacement === null ? `{${field}}` : String(replacement);
  });
}

function getRegisteredSettingValue(settingKey, fallback) {
  const fullKey = `${MODULE_ID}.${settingKey}`;
  if (!game?.settings?.settings?.has(fullKey)) return fallback;

  try {
    return game.settings.get(MODULE_ID, settingKey);
  } catch (_error) {
    return fallback;
  }
}

function getPreferredLanguage() {
  return getRegisteredSettingValue(UI_LANGUAGE_SETTING, "default");
}

function normalizeUiLanguage(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_UI_LANGUAGE;
  if (SUPPORTED_UI_LANGUAGES.includes(normalized)) return normalized;

  const baseLanguage = normalized.split(/[-_.]/)[0];
  return SUPPORTED_UI_LANGUAGES.includes(baseLanguage) ? baseLanguage : DEFAULT_UI_LANGUAGE;
}

function getModuleLanguage(preferredLanguage=getPreferredLanguage()) {
  if (SUPPORTED_UI_LANGUAGES.includes(preferredLanguage)) return preferredLanguage;
  return normalizeUiLanguage(game.i18n?.lang);
}

async function loadModuleTranslations(language) {
  const normalized = normalizeUiLanguage(language);
  if (MODULE_TRANSLATION_CACHE.has(normalized)) return MODULE_TRANSLATION_CACHE.get(normalized);

  const response = await fetch(`modules/${MODULE_ID}/lang/${normalized}.json`);
  if (!response.ok) {
    throw new Error(`Failed to load ${normalized} translations (${response.status})`);
  }

  const translations = await response.json();
  MODULE_TRANSLATION_CACHE.set(normalized, translations);
  return translations;
}

async function ensureModuleTranslationsLoaded() {
  if (!MODULE_TRANSLATION_LOAD) {
    MODULE_TRANSLATION_LOAD = Promise.all(SUPPORTED_UI_LANGUAGES.map((language) => loadModuleTranslations(language)))
      .catch((error) => {
        console.warn(`${MODULE_ID} |`, error);
        return null;
      });
  }

  return MODULE_TRANSLATION_LOAD;
}

function resetModuleTranslationState() {
  MODULE_TRANSLATION_CACHE.clear();
  MODULE_TRANSLATION_LOAD = null;
}

function getThemePreference() {
  return getRegisteredSettingValue(UI_THEME_SETTING, "signature");
}

function getLocaleForModule(preferredLanguage=getPreferredLanguage()) {
  return preferredLanguage === "default" ? normalizeUiLanguage(game.i18n?.lang) : preferredLanguage;
}

function getDocumentType(document) {
  return document?.documentName ?? document?.constructor?.metadata?.name ?? null;
}

function getSupportedDocumentConfig(documentName) {
  return SUPPORTED_DOCUMENTS.find((config) => config.documentName === documentName) ?? null;
}

function getDocumentCollection(documentName) {
  return getSupportedDocumentConfig(documentName)?.getCollection() ?? null;
}

function getDocumentTypeLabel(documentOrName) {
  const documentName = typeof documentOrName === "string" ? documentOrName : getDocumentType(documentOrName);
  if (!documentName) return localize("scbr.document.unknown", "Document");

  const key = `DOCUMENT.${documentName}`;
  const localized = game.i18n.localize(key);
  return localized === key ? documentName : localized;
}

function getDocumentDisplayName(document) {
  const name = document?.name?.trim();
  if (name) return name;
  return `${getDocumentTypeLabel(document)} ${document?.id ?? ""}`.trim();
}

function getTimestampString(dateString, languageOverride) {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleString(getLocaleForModule(languageOverride));
}

function formatBackupLabel(backup, languageOverride) {
  const timestamp = getTimestampString(backup?.createdAt, languageOverride);
  const name = backup?.name?.trim() || localize("scbr.backup.unnamed", "Unnamed Backup", languageOverride);
  return timestamp ? `${name} (${timestamp})` : name;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getBackupDisplayParts(backup, languageOverride) {
  return {
    name: backup?.name?.trim() || localize("scbr.backup.unnamed", "Unnamed Backup", languageOverride),
    timestamp: getTimestampString(backup?.createdAt, languageOverride) || localize("scbr.backup.noDate", "No timestamp", languageOverride)
  };
}

function ensureStylesLoaded() {
  const href = `modules/${MODULE_ID}/styles/scbr.css`;
  if (document.querySelector(`link[data-${MODULE_ID}-styles]`)) return;
  if (Array.from(document.styleSheets).some((sheet) => sheet.href?.includes(href))) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${href}?v=${encodeURIComponent(game.modules.get(MODULE_ID)?.version ?? Date.now())}`;
  link.setAttribute(`data-${MODULE_ID}-styles`, "true");
  document.head.append(link);
}

function applyDialogTheme(element, theme=getThemePreference()) {
  if (!element) return;

  const resolvedTheme = theme === "foundry" ? "foundry" : "signature";
  element.dataset.uiTheme = resolvedTheme;
  element.classList.toggle("is-theme-foundry", resolvedTheme === "foundry");
  element.classList.toggle("is-theme-signature", resolvedTheme !== "foundry");
}

function sanitizePathSegment(value, fallback="unknown") {
  const normalized = String(value ?? "").trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function getWorldStorageRoot() {
  // Backup payloads belong to the world, so keep them under the world's data tree.
  return `worlds/${game.world.id}/${WORLD_STORAGE_ROOT}`;
}

function getLegacyWorldStorageRoot() {
  return `worlds/${game.world.id}/${MODULE_ID}`;
}

function getStorageRoots() {
  return [getWorldStorageRoot(), getLegacyWorldStorageRoot(), LEGACY_STORAGE_ROOT];
}

function normalizeStoragePath(path) {
  const normalized = String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  for (const root of getStorageRoots()) {
    const prefix = `${root}/`;
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    if (normalized === root) return "";
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDocumentTypeStoragePath(documentType) {
  return `${sanitizePathSegment(documentType, "Document")}.json`;
}

function parseBackupPath(path, backupId=null, documentType=null) {
  const normalized = normalizeStoragePath(path);
  const [filePart, hashPart] = normalized.split("#", 2);
  const filePath = filePart || getDocumentTypeStoragePath(documentType);
  const resolvedBackupId = hashPart || backupId || null;
  const resolvedType = documentType || filePath.replace(/\.json$/i, "") || null;
  return {
    normalized,
    filePath,
    backupId: resolvedBackupId,
    documentType: resolvedType
  };
}

function buildBackupStoragePath(backup) {
  const filePath = getDocumentTypeStoragePath(backup.documentType);
  return `${filePath}#${sanitizePathSegment(backup.id, "backup")}`;
}

function sortBackups(backups) {
  return [...backups]
    .filter(Boolean)
    .sort((left, right) => String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")));
}

function getRootedStoragePath(path, root=getWorldStorageRoot()) {
  return `${root}/${normalizeStoragePath(path)}`;
}

function getBackupFetchUrl(path, root=getWorldStorageRoot()) {
  return getRootedStoragePath(path, root);
}

function getBackupFileName(path) {
  const { filePath } = parseBackupPath(path);
  const parts = normalizeStoragePath(filePath).split("/").filter(Boolean);
  return parts.at(-1) ?? "backup.json";
}

function getBackupDirectoryPath(path) {
  const { filePath } = parseBackupPath(path);
  const parts = normalizeStoragePath(filePath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

async function acquireBackupStoreLock({ timeoutMs=BACKUP_LOCK_TIMEOUT_MS, retryMs=BACKUP_LOCK_RETRY_MS } = {}) {
  const token = `${game.user.id}-${foundry.utils.randomID()}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = game.settings.get(MODULE_ID, STORE_LOCK_SETTING);
    const expiresAt = Number(current?.expiresAt ?? 0);
    const active = current?.token && expiresAt > Date.now() && current.owner !== game.user.id;

    if (active) {
      await sleep(retryMs);
      continue;
    }

    const candidate = {
      token,
      owner: game.user.id,
      expiresAt: Date.now() + timeoutMs,
      acquiredAt: new Date().toISOString()
    };

    await game.settings.set(MODULE_ID, STORE_LOCK_SETTING, candidate);
    const written = game.settings.get(MODULE_ID, STORE_LOCK_SETTING);
    if (written?.token === token) return token;

    await sleep(retryMs);
  }

  throw new Error("Timed out while waiting for backup storage lock.");
}

async function releaseBackupStoreLock(token) {
  const current = game.settings.get(MODULE_ID, STORE_LOCK_SETTING);
  if (current?.token !== token) return;

  await game.settings.set(MODULE_ID, STORE_LOCK_SETTING, {
    token: null,
    owner: null,
    expiresAt: 0,
    acquiredAt: null
  });
}

async function withBackupStoreLock(fn, options={}) {
  const token = await acquireBackupStoreLock(options);
  try {
    return await fn();
  } finally {
    await releaseBackupStoreLock(token);
  }
}

async function ensureStorageDirectoryExists(path) {
  const filePicker = foundry.applications.apps.FilePicker.implementation;
  const target = getRootedStoragePath(path);
  const segments = target.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    try {
      await filePicker.createDirectory("data", currentPath, { notify: false });
    } catch (error) {
      const message = error?.message ?? String(error ?? "");
      if (!/EEXIST|already exists|FILES.ErrorCreateDirExists/i.test(message)) throw error;
    }
  }
}

async function writeBackupFile(backup, path=null) {
  return withBackupStoreLock(async () => {
    const resolvedPath = normalizeStoragePath(path ?? backup.path) || buildBackupStoragePath(backup);
    const parsedPath = parseBackupPath(resolvedPath, backup?.id, backup?.documentType);
    await ensureStorageDirectoryExists(getBackupDirectoryPath(parsedPath.filePath));

    let store = { version: BACKUP_STORAGE_VERSION, documentType: parsedPath.documentType, backups: [] };
    for (const root of getStorageRoots()) {
      const response = await fetch(`${getBackupFetchUrl(parsedPath.filePath, root)}?ts=${encodeURIComponent(Date.now())}`, { cache: "no-store" });
      if (!response.ok) continue;
      const loaded = await response.json();
      if (Array.isArray(loaded?.backups)) {
        store = {
          version: loaded.version ?? BACKUP_STORAGE_VERSION,
          documentType: loaded.documentType ?? parsedPath.documentType,
          backups: loaded.backups.map((entry) => normalizeBackup(entry)).filter(Boolean)
        };
      }
      break;
    }

    const payload = {
      ...backup,
      path: resolvedPath,
      data: foundry.utils.deepClone(backup.data)
    };

    const backupId = parsedPath.backupId || payload.id;
    if (!backupId) throw new Error("Cannot persist backup without an id.");

    const nextBackups = sortBackups([
      ...store.backups.filter((entry) => entry.id !== backupId),
      { ...payload, id: backupId, documentType: parsedPath.documentType, path: `${parsedPath.filePath}#${backupId}` }
    ]);

    const serializedStore = {
      version: BACKUP_STORAGE_VERSION,
      documentType: parsedPath.documentType,
      backups: nextBackups
    };

    const file = new File([
      JSON.stringify(serializedStore, null, 2)
    ], getBackupFileName(parsedPath.filePath), {
      type: "application/json",
      lastModified: Date.now()
    });

    const response = await FilePicker.upload("data", getRootedStoragePath(getBackupDirectoryPath(parsedPath.filePath)), file, {}, { notify: false });
    if (!response?.path) {
      throw new Error(`Failed to write backup file '${parsedPath.filePath}'.`);
    }

    return normalizeBackup({ ...payload, id: backupId, documentType: parsedPath.documentType, path: `${parsedPath.filePath}#${backupId}` });
  });
}

async function readBackupFile(backup, { includeSource=false } = {}) {
  const path = normalizeStoragePath(backup?.path);
  if (!path && !backup?.id) {
    throw new Error(format("scbr.notification.invalidBackup", { documentName: backup?.documentName ?? localize("scbr.document.unknown", "Document") }, `The stored backup for '${backup?.documentName ?? localize("scbr.document.unknown", "Document")}' is invalid.`));
  }

  const parsedPath = parseBackupPath(path, backup?.id, backup?.documentType);
  if (!parsedPath.filePath || !parsedPath.backupId) {
    throw new Error(format("scbr.notification.invalidBackup", { documentName: backup?.documentName ?? localize("scbr.document.unknown", "Document") }, `The stored backup for '${backup?.documentName ?? localize("scbr.document.unknown", "Document")}' is invalid.`));
  }

  let payload = null;
  let sourceRoot = null;

  for (const root of getStorageRoots()) {
    const response = await fetch(`${getBackupFetchUrl(parsedPath.filePath, root)}?ts=${encodeURIComponent(Date.now())}`, { cache: "no-store" });
    if (!response.ok) continue;
    const loaded = await response.json();

    // Storage format: one file per document type with a backups array.
    if (Array.isArray(loaded?.backups)) {
      const backups = loaded.backups.map((entry) => normalizeBackup(entry)).filter(Boolean);
      payload = backups.find((entry) => entry.id === parsedPath.backupId) ?? null;
    }

    if (!payload) continue;
    sourceRoot = root;
    break;
  }

  if (!payload) {
    throw new Error(format("scbr.notification.invalidBackup", { documentName: backup?.documentName ?? localize("scbr.document.unknown", "Document") }, `The stored backup for '${backup?.documentName ?? localize("scbr.document.unknown", "Document")}' is invalid.`));
  }

  const normalized = normalizeBackup({ ...payload, path: `${parsedPath.filePath}#${parsedPath.backupId}` });

  if (includeSource) {
    return {
      backup: normalized,
      sourceRoot
    };
  }

  return normalized;
}

async function deleteBackupFile(path, { storageRoots=null } = {}) {
  return withBackupStoreLock(async () => {
    const normalizedPath = normalizeStoragePath(path);
    if (!normalizedPath) return { deleted: false, unsupported: false };

    const parsedPath = parseBackupPath(normalizedPath);
    if (!parsedPath.filePath || !parsedPath.backupId) return { deleted: false, unsupported: false };

    const roots = storageRoots ?? getStorageRoots();
    let deleted = false;

    for (const root of roots) {
      const response = await fetch(`${getBackupFetchUrl(parsedPath.filePath, root)}?ts=${encodeURIComponent(Date.now())}`, { cache: "no-store" });
      if (!response.ok) continue;

      const loaded = await response.json();
      const currentBackups = Array.isArray(loaded?.backups)
        ? loaded.backups.map((entry) => normalizeBackup(entry)).filter(Boolean)
        : [];
      const nextBackups = currentBackups.filter((entry) => entry.id !== parsedPath.backupId);
      if (nextBackups.length === currentBackups.length) continue;

      await ensureStorageDirectoryExists(getBackupDirectoryPath(parsedPath.filePath));

      const serializedStore = {
        version: BACKUP_STORAGE_VERSION,
        documentType: loaded?.documentType ?? parsedPath.documentType,
        backups: nextBackups
      };

      const file = new File([
        JSON.stringify(serializedStore, null, 2)
      ], getBackupFileName(parsedPath.filePath), {
        type: "application/json",
        lastModified: Date.now()
      });

      const upload = await FilePicker.upload("data", getRootedStoragePath(getBackupDirectoryPath(parsedPath.filePath)), file, {}, { notify: false });
      if (!upload?.path) {
        throw new Error(`Failed to update backup file '${parsedPath.filePath}'.`);
      }
      deleted = true;
      break;
    }

    return { deleted, unsupported: false };
  });
}

function normalizeBackupIndex(backup) {
  const path = normalizeStoragePath(backup?.path ?? backup?.filePath);
  if (!path) return null;

  return {
    id: backup.id || foundry.utils.randomID(),
    name: backup.name?.trim() || backup.documentName || localize("scbr.backup.unnamed", "Unnamed Backup"),
    documentId: backup.documentId || null,
    documentName: backup.documentName || localize("scbr.backup.unnamed", "Unnamed Backup"),
    documentType: backup.documentType || null,
    createdAt: backup.createdAt || new Date().toISOString(),
    coreGeneration: backup.coreGeneration ?? null,
    path
  };
}

function normalizeBackup(backup) {
  if (!backup?.data || typeof backup.data !== "object") return null;

  return {
    id: backup.id || foundry.utils.randomID(),
    name: backup.name?.trim() || backup.documentName || localize("scbr.backup.unnamed", "Unnamed Backup"),
    documentId: backup.documentId || null,
    documentName: backup.documentName || localize("scbr.backup.unnamed", "Unnamed Backup"),
    documentType: backup.documentType || null,
    createdAt: backup.createdAt || new Date().toISOString(),
    coreGeneration: backup.coreGeneration ?? null,
    path: normalizeStoragePath(backup.path ?? backup.filePath),
    data: foundry.utils.deepClone(backup.data)
  };
}

function getStoredBackupSetting(moduleId=MODULE_ID) {
  return game.settings.get(moduleId, STORE_SETTING);
}

function getBackupStore() {
  const stored = getStoredBackupSetting(MODULE_ID);
  if (!stored || !Array.isArray(stored.backups)) {
    return {
      version: BACKUP_STORAGE_VERSION,
      backups: []
    };
  }

  return {
    version: stored.version ?? BACKUP_STORAGE_VERSION,
    backups: stored.backups.map((backup) => normalizeBackupIndex(backup)).filter(Boolean)
  };
}

function getEmbeddedBackupsFromStore(moduleId=MODULE_ID) {
  const stored = getStoredBackupSetting(moduleId);
  if (!stored || !Array.isArray(stored.backups)) return [];
  return stored.backups.map((backup) => normalizeBackup(backup)).filter(Boolean);
}

function getLegacyBackupStore(moduleId) {
  const stored = getStoredBackupSetting(moduleId);
  if (!stored || !Array.isArray(stored.backups)) return [];
  return stored.backups.map((backup) => normalizeBackup(backup)).filter(Boolean);
}

async function collectBackupsFromTypeFiles() {
  const collected = [];

  for (const config of SUPPORTED_DOCUMENTS) {
    const filePath = getDocumentTypeStoragePath(config.documentName);
    const response = await fetch(`${getBackupFetchUrl(filePath, getWorldStorageRoot())}?ts=${encodeURIComponent(Date.now())}`, { cache: "no-store" });
    if (!response.ok) continue;

    const loaded = await response.json();
    if (!Array.isArray(loaded?.backups)) continue;

    for (const raw of loaded.backups) {
      const normalized = normalizeBackup({ ...raw, documentType: raw.documentType || config.documentName });
      if (!normalized) continue;
      collected.push(normalizeBackupIndex({ ...normalized, path: `${filePath}#${normalized.id}` }));
    }
  }

  return sortBackups(collected).filter(Boolean);
}

async function clearBackupStore(moduleId) {
  if (moduleId !== MODULE_ID) {
    await game.settings.set(moduleId, STORE_SETTING, {
      version: BACKUP_STORAGE_VERSION,
      backups: []
    });
    return;
  }

  await withBackupStoreLock(async () => {
    await game.settings.set(moduleId, STORE_SETTING, {
      version: BACKUP_STORAGE_VERSION,
      backups: []
    });
  });
}

async function unsetLegacyDocumentFlag(document, scope, key) {
  try {
    await document.unsetFlag(scope, key);
  } catch (error) {
    const message = error?.message ?? String(error ?? "");
    if (/not valid or not currently active/i.test(message)) return;
    throw error;
  }
}

async function saveBackupStore(backups) {
  await withBackupStoreLock(async () => {
    const indexedFromFiles = await collectBackupsFromTypeFiles();
    const fallbackIndex = sortBackups(backups ?? []).map((backup) => normalizeBackupIndex(backup)).filter(Boolean);
    const normalizedBackups = indexedFromFiles.length ? indexedFromFiles : fallbackIndex;

    await game.settings.set(MODULE_ID, STORE_SETTING, {
      version: BACKUP_STORAGE_VERSION,
      backups: normalizedBackups
    });
  });
}

function getAllBackups() {
  return sortBackups(getBackupStore().backups);
}

function getBackups(document) {
  const documentType = getDocumentType(document);
  return getAllBackups().filter((backup) => backup.documentType === documentType && backup.documentId === document.id);
}

function getBackupById(document, backupId) {
  return getBackups(document).find((backup) => backup.id === backupId) ?? null;
}

async function setBackups(document, backups) {
  const documentType = getDocumentType(document);
  const remaining = getAllBackups().filter((backup) => !(backup.documentType === documentType && backup.documentId === document.id));
  await saveBackupStore([...remaining, ...backups]);
}

function getLegacyBackups(document) {
  const namespaces = [MODULE_ID, ...LEGACY_MODULE_IDS];
  let stored = null;

  for (const namespace of namespaces) {
    stored = foundry.utils.getProperty(document, `flags.${namespace}.${LEGACY_FLAG}`);
    if (stored) break;
  }

  if (!stored && getDocumentType(document) === "Scene") {
    for (const namespace of namespaces) {
      stored = foundry.utils.getProperty(document, `flags.${namespace}.${LEGACY_SCENE_BACKUP_FLAG}`);
      if (stored) break;
    }
  }

  if (!stored) return [];

  const rawBackups = Array.isArray(stored?.backups)
    ? stored.backups
    : Array.isArray(stored)
      ? stored
      : [stored];

  return rawBackups
    .map((backup) => normalizeBackup({
      ...backup,
      documentId: backup.documentId || document.id,
      documentName: backup.documentName || getDocumentDisplayName(document),
      documentType: backup.documentType || getDocumentType(document)
    }))
    .filter(Boolean);
}

async function migrateLegacyBackups() {
  const embeddedBackups = getEmbeddedBackupsFromStore(MODULE_ID);
  const rawModuleStore = getStoredBackupSetting(MODULE_ID);
  const embeddedKeys = new Set((rawModuleStore?.backups ?? [])
    .filter((backup) => backup?.data && typeof backup.data === "object")
    .map((backup) => `${backup.documentType ?? null}|${backup.documentId ?? null}|${backup.id ?? null}`));
  const indexedBackups = getAllBackups().filter((backup) => !embeddedKeys.has(`${backup.documentType}|${backup.documentId}|${backup.id}`));
  const existing = [];
  const legacyStoresToClear = new Set();
  let migratedIndexedBackups = false;
  let migratedDocumentFlags = false;

  // Re-home indexed files into the world storage root when they still point to legacy module storage.
  for (const entry of indexedBackups) {
    const resolved = await readBackupFile(entry, { includeSource: true });
    const canonicalPath = buildBackupStoragePath(resolved.backup);
    if (resolved.sourceRoot !== getWorldStorageRoot() || normalizeStoragePath(entry.path) !== canonicalPath) {
      const rewritten = await writeBackupFile(resolved.backup, canonicalPath);
      await deleteBackupFile(resolved.backup.path || entry.path, { storageRoots: [resolved.sourceRoot] });
      existing.push(normalizeBackupIndex(rewritten));
      migratedIndexedBackups = true;
    } else {
      existing.push(entry);
    }
  }
  const seen = new Set(existing.map((backup) => `${backup.documentType}|${backup.documentId}|${backup.id}`));
  const merged = [...existing];
  let changed = embeddedBackups.length > 0 || migratedIndexedBackups;

  for (const backup of embeddedBackups) {
    const key = `${backup.documentType}|${backup.documentId}|${backup.id}`;
    if (seen.has(key)) continue;
    const persisted = await writeBackupFile(backup);
    seen.add(key);
    merged.push(normalizeBackupIndex(persisted));
  }

  for (const legacyModuleId of LEGACY_MODULE_IDS) {
    const legacyStoreBackups = getLegacyBackupStore(legacyModuleId);
    if (legacyStoreBackups.length) legacyStoresToClear.add(legacyModuleId);

    for (const backup of legacyStoreBackups) {
      const key = `${backup.documentType}|${backup.documentId}|${backup.id}`;
      if (seen.has(key)) continue;
      const persisted = await writeBackupFile(backup);
      seen.add(key);
      merged.push(normalizeBackupIndex(persisted));
      changed = true;
    }
  }

  for (const config of SUPPORTED_DOCUMENTS) {
    for (const document of config.getCollection()?.contents ?? []) {
      const legacyBackups = getLegacyBackups(document);
      if (!legacyBackups.length) continue;

      for (const backup of legacyBackups) {
        const key = `${backup.documentType}|${backup.documentId}|${backup.id}`;
        if (seen.has(key)) continue;
        const persisted = await writeBackupFile(backup);
        seen.add(key);
        merged.push(normalizeBackupIndex(persisted));
        changed = true;
      }

      for (const namespace of [MODULE_ID, ...LEGACY_MODULE_IDS]) {
        await unsetLegacyDocumentFlag(document, namespace, LEGACY_FLAG);
        if (config.documentName === "Scene") {
          await unsetLegacyDocumentFlag(document, namespace, LEGACY_SCENE_BACKUP_FLAG);
        }
      }
      migratedDocumentFlags = true;
    }
  }

  if (changed) {
    await saveBackupStore(merged);
  }

  if (migratedDocumentFlags || legacyStoresToClear.size) {
    for (const legacyModuleId of legacyStoresToClear) {
      await clearBackupStore(legacyModuleId);
    }
  }
}

function getContextDataset(target) {
  if (!target) return null;
  if (target instanceof HTMLElement) return target.dataset;
  if (typeof target.data === "function") {
    return {
      entryId: target.data("entryId"),
      sceneId: target.data("sceneId"),
      documentId: target.data("documentId")
    };
  }
  return null;
}

function getDocumentIdFromContext(target) {
  const dataset = getContextDataset(target);
  return dataset?.entryId ?? dataset?.sceneId ?? dataset?.documentId ?? null;
}

function buildBackupPayload(document, name) {
  const data = document.toObject();
  if (data.flags?.[MODULE_ID]) {
    delete data.flags[MODULE_ID];
    if (!Object.keys(data.flags).length) delete data.flags;
  }

  return {
    id: foundry.utils.randomID(),
    name: name?.trim() || getDocumentDisplayName(document),
    documentId: document.id,
    documentName: getDocumentDisplayName(document),
    documentType: getDocumentType(document),
    createdAt: new Date().toISOString(),
    coreGeneration: game.release?.generation ?? null,
    data
  };
}

function sanitizeFlags(data) {
  if (!data.flags?.[MODULE_ID]) return;
  delete data.flags[MODULE_ID];
  if (!Object.keys(data.flags).length) delete data.flags;
}

function buildRestoreData(document, backup) {
  if (!backup?.data || typeof backup.data !== "object") {
    throw new Error(format("scbr.notification.invalidBackup", { documentName: getDocumentDisplayName(document) }, `The stored backup for '${getDocumentDisplayName(document)}' is invalid.`));
  }

  const restoreData = foundry.utils.deepClone(backup.data);
  restoreData._id = document.id;
  restoreData.name ??= getDocumentDisplayName(document);
  sanitizeFlags(restoreData);
  return restoreData;
}

function buildReconstructionData(backup) {
  const createData = foundry.utils.deepClone(backup.data);
  delete createData._id;
  createData.name ??= backup.documentName;
  sanitizeFlags(createData);

  if (createData.folder && !game.folders.get(createData.folder)) {
    createData.folder = null;
  }

  return createData;
}

function getDocumentBackupSummary(document) {
  const backups = getBackups(document);
  if (!backups.length) return null;
  return {
    count: backups.length,
    latest: backups[0]
  };
}

function resolveDocumentForBackup(backup) {
  return getDocumentCollection(backup.documentType)?.get(backup.documentId) ?? null;
}

function createEntryFromBackup(backup) {
  return {
    backup,
    document: resolveDocumentForBackup(backup)
  };
}

async function promptForBackupName(document) {
  const defaultName = getDocumentDisplayName(document);
  const content = buildDialogLayout({
    eyebrow: getDocumentTypeLabel(document),
    title: localize("scbr.dialog.create.title", "Create Backup"),
    summary: format("scbr.dialog.create.summary", { documentName: getDocumentDisplayName(document) }, `Create a new backup for ${getDocumentDisplayName(document)}.`),
    count: getBackups(document).length,
    sectionLabel: localize("scbr.dialog.create.nameLabel", "Backup name"),
    sectionHint: localize("scbr.dialog.create.hint", "The current date and time are stored automatically."),
    showCount: false,
    showPanelHeader: false,
    rowsHtml: `
      <div class="scbr-input-panel">
        <div class="scbr-field-group">
          <label class="scbr-panel-title" for="scbr-name-input">${escapeHtml(localize("scbr.dialog.create.nameLabel", "Backup name"))}</label>
          <input id="scbr-name-input" class="scbr-text-input" type="text" name="backupName" value="${escapeHtml(defaultName)}" autofocus>
        </div>
      </div>
    `
  });

  const name = await waitForBackupDialog({
    title: localize("scbr.dialog.create.title", "Create Backup"),
    content,
    dialogClass: "scbr-dialog scbr-create-dialog",
    width: 720,
    autoHeight: true,
    onRender: (dialog) => {
      const input = dialog.element.querySelector("#scbr-name-input");
      input?.focus();
      input?.select();
    },
    buttons: [
      {
        action: "submit",
        label: localize("scbr.dialog.create.submit", "Create Backup"),
        default: true,
        callback: (_event, button) => button.form.elements.backupName.value.trim()
      },
      {
        action: "cancel",
        label: localize("scbr.action.cancel", "Cancel")
      }
    ]
  });

  return name ?? null;
}

async function createBackup(document) {
  const name = await promptForBackupName(document);
  if (name === null) return;

  const backups = getBackups(document);
  const payload = buildBackupPayload(document, name);
  const storedBackup = await writeBackupFile(payload);
  backups.unshift(normalizeBackupIndex(storedBackup));

  await setBackups(document, backups);
  ui.notifications.info(format("scbr.notification.backupCreated", {
    backupName: formatBackupLabel(storedBackup),
    documentName: getDocumentDisplayName(document)
  }, `Backup '${formatBackupLabel(storedBackup)}' created for '${getDocumentDisplayName(document)}'.`));
}

async function restoreBackup(document, backupId) {
  const backupIndex = getBackupById(document, backupId);
  if (!backupIndex) {
    ui.notifications.warn(format("scbr.notification.noBackup", { documentName: getDocumentDisplayName(document) }, `No backup exists for '${getDocumentDisplayName(document)}'.`));
    return;
  }

  const backup = await readBackupFile(backupIndex);
  const restoreData = buildRestoreData(document, backup);
  await document.update(restoreData, { diff: false, recursive: false });

  if (getDocumentType(document) === "Scene" && canvas?.scene?.id === document.id) {
    await canvas.draw();
  }

  ui.notifications.info(format("scbr.notification.backupRestored", {
    backupName: formatBackupLabel(backup),
    documentName: getDocumentDisplayName(document)
  }, `Backup '${formatBackupLabel(backup)}' restored for '${getDocumentDisplayName(document)}'.`));
}

async function reconstructDocumentFromBackup(backup) {
  const storedBackup = await readBackupFile(backup);
  const collection = getDocumentCollection(storedBackup.documentType);
  if (!collection?.documentClass) {
    throw new Error(format("scbr.notification.unsupportedRecovery", { documentType: getDocumentTypeLabel(storedBackup.documentType) }, `Recovery is not supported for '${getDocumentTypeLabel(storedBackup.documentType)}'.`));
  }

  const createData = buildReconstructionData(storedBackup);
  const created = await collection.documentClass.create(createData, { renderSheet: true });
  if (!created) return null;

  const updatedBackups = [];
  for (const entry of getAllBackups()) {
    if (entry.documentType !== storedBackup.documentType || entry.documentId !== storedBackup.documentId) {
      updatedBackups.push(entry);
      continue;
    }

    const record = await readBackupFile(entry);
    const rewritten = await writeBackupFile({
      ...record,
      documentId: created.id,
      documentName: getDocumentDisplayName(created),
      data: {
        ...foundry.utils.deepClone(record.data),
        _id: created.id,
        name: getDocumentDisplayName(created)
      }
    }, entry.path);
    updatedBackups.push(normalizeBackupIndex(rewritten));
  }
  await saveBackupStore(updatedBackups);

  ui.notifications.info(format("scbr.notification.reconstructed", {
    documentName: getDocumentDisplayName(created),
    backupName: formatBackupLabel(storedBackup)
  }, `Reconstructed '${getDocumentDisplayName(created)}' from backup '${formatBackupLabel(storedBackup)}'.`));

  return created;
}

async function removeBackupByEntry(backup) {
  const remaining = getAllBackups().filter((entry) => entry.id !== backup.id);
  await deleteBackupFile(backup.path);
  await saveBackupStore(remaining);
}

async function removeBackup(document, backupId) {
  const backup = getBackupById(document, backupId);
  if (!backup) {
    ui.notifications.warn(format("scbr.notification.noBackup", { documentName: getDocumentDisplayName(document) }, `No backup exists for '${getDocumentDisplayName(document)}'.`));
    return;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: {
      title: localize("scbr.dialog.deleteConfirm.title", "Delete Backup")
    },
    content: `<p>${foundry.utils.escapeHTML(format("scbr.dialog.deleteConfirm.body", {
      backupName: formatBackupLabel(backup),
      documentName: getDocumentDisplayName(document)
    }, `Delete backup '${formatBackupLabel(backup)}' from '${getDocumentDisplayName(document)}'?`))}</p>`,
    yes: {
      label: localize("scbr.dialog.deleteConfirm.confirm", "Delete")
    },
    no: {
      label: localize("scbr.action.cancel", "Cancel")
    },
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return;

  await removeBackupByEntry(backup);
  ui.notifications.info(format("scbr.notification.backupRemoved", {
    backupName: formatBackupLabel(backup),
    documentName: getDocumentDisplayName(document)
  }, `Backup '${formatBackupLabel(backup)}' removed for '${getDocumentDisplayName(document)}'.`));
}

async function removeBackupEntry(entry) {
  const documentName = entry.document ? getDocumentDisplayName(entry.document) : entry.backup.documentName;
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: {
      title: localize("scbr.dialog.deleteConfirm.title", "Delete Backup")
    },
    content: `<p>${foundry.utils.escapeHTML(format("scbr.dialog.deleteConfirm.body", {
      backupName: formatBackupLabel(entry.backup),
      documentName
    }, `Delete backup '${formatBackupLabel(entry.backup)}' from '${documentName}'?`))}</p>`,
    yes: {
      label: localize("scbr.dialog.deleteConfirm.confirm", "Delete")
    },
    no: {
      label: localize("scbr.action.cancel", "Cancel")
    },
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return;

  await removeBackupByEntry(entry.backup);
  ui.notifications.info(format("scbr.notification.backupRemoved", {
    backupName: formatBackupLabel(entry.backup),
    documentName
  }, `Backup '${formatBackupLabel(entry.backup)}' removed for '${documentName}'.`));
}

async function runDocumentAction(document, action) {
  try {
    await action(document);
  } catch (error) {
    console.error(`${MODULE_ID} |`, error);
    ui.notifications.error(format("scbr.notification.error", { message: error.message ?? String(error) }, `Sephral’s Content Backup & Restore failed: ${error.message ?? String(error)}`));
  }
}

async function runRecoveryAction(action) {
  try {
    await action();
  } catch (error) {
    console.error(`${MODULE_ID} |`, error);
    ui.notifications.error(format("scbr.notification.error", { message: error.message ?? String(error) }, `Sephral’s Content Backup & Restore failed: ${error.message ?? String(error)}`));
  }
}

function getEntryPrimaryAction(entry, { recoveryMode=false } = {}) {
  if (entry.document) {
    return {
      action: "restore",
      tooltip: localize("scbr.manager.restore", "Restore Backup"),
      icon: "fas fa-rotate-left"
    };
  }

  if (recoveryMode) {
    return {
      action: "reconstruct",
      tooltip: localize("scbr.manager.reconstruct", "Reconstruct Document"),
      icon: "fas fa-plus"
    };
  }

  return null;
}

function getDocumentPickerOptions(documentType, selectedDocumentId, preferredDocument=null) {
  const collection = getDocumentCollection(documentType);
  const liveDocuments = collection?.contents ?? [];
  const backupEntries = getAllBackups().filter((backup) => backup.documentType === documentType);
  const optionMap = new Map();

  for (const document of liveDocuments) {
    optionMap.set(document.id, {
      id: document.id,
      name: getDocumentDisplayName(document),
      deleted: false
    });
  }

  for (const backup of backupEntries) {
    if (!optionMap.has(backup.documentId)) {
      optionMap.set(backup.documentId, {
        id: backup.documentId,
        name: backup.documentName,
        deleted: true
      });
    }
  }

  if (preferredDocument && getDocumentType(preferredDocument) === documentType && !optionMap.has(preferredDocument.id)) {
    optionMap.set(preferredDocument.id, {
      id: preferredDocument.id,
      name: getDocumentDisplayName(preferredDocument),
      deleted: false
    });
  }

  const sortedOptions = Array.from(optionMap.values()).sort((left, right) => left.name.localeCompare(right.name, getLocaleForModule()));
  const allLabel = format("scbr.filter.document.all", { documentType: getDocumentTypeLabel(documentType) }, `All ${getDocumentTypeLabel(documentType)}`);

  return [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...sortedOptions.map((option) => {
      const selected = option.id === selectedDocumentId ? " selected" : "";
      const suffix = option.deleted ? ` ${localize("scbr.manager.missing", "[deleted]")}` : "";
      return `<option value="${escapeHtml(option.id)}"${selected}>${escapeHtml(`${option.name}${suffix}`)}</option>`;
    })
  ].join("");
}

function buildRecoveryTypeOptions(selectedType) {
  const counts = new Map();
  for (const backup of getAllBackups()) {
    counts.set(backup.documentType, (counts.get(backup.documentType) ?? 0) + 1);
  }

  const visibleConfigs = SUPPORTED_DOCUMENTS.filter((config) => (counts.get(config.documentName) ?? 0) > 0);
  const fallbackConfig = SUPPORTED_DOCUMENTS.find((config) => config.documentName === selectedType) ?? SUPPORTED_DOCUMENTS[0] ?? null;
  const configs = visibleConfigs.length ? visibleConfigs : (fallbackConfig ? [fallbackConfig] : []);

  return configs.map((config) => {
    const count = counts.get(config.documentName) ?? 0;
    const selected = config.documentName === selectedType ? " selected" : "";
    return `<option value="${escapeHtml(config.documentName)}"${selected}>${escapeHtml(`${getDocumentTypeLabel(config.documentName)} (${count})`)}</option>`;
  }).join("");
}

function buildDialogLayout({ eyebrow, title, summary, count, sectionLabel, sectionHint, rowsHtml, toolbarHtml="", showCount=true, showPanelHeader=true }) {
  const countLabel = localize("scbr.manager.countLabel", "Backups");

  return `
    <div class="scbr-shell">
      <section class="scbr-hero">
        <div class="scbr-hero-copy">
          <div class="scbr-eyebrow">${escapeHtml(eyebrow)}</div>
          <div class="scbr-heading-row">
            <h2 class="scbr-heading scbr-dynamic-title">${escapeHtml(title)}</h2>
            ${showCount ? `<div class="scbr-stat-inline">
              <span class="scbr-stat-value scbr-dynamic-count">${escapeHtml(count)}</span>
              <span class="scbr-stat-label">${escapeHtml(countLabel)}</span>
            </div>` : ""}
          </div>
          <p class="scbr-summary">${escapeHtml(summary)}</p>
        </div>
      </section>
      <section class="scbr-panel">
        ${showPanelHeader ? `<div class="scbr-panel-header">
          <div class="scbr-panel-heading">
            <label class="scbr-panel-title scbr-dynamic-section-label">${escapeHtml(sectionLabel)}</label>
            <span class="scbr-panel-hint">${escapeHtml(sectionHint)}</span>
          </div>
          ${toolbarHtml}
        </div>` : ""}
        ${rowsHtml}
      </section>
    </div>
  `;
}

function getLanguageSettingChoices() {
  return Object.fromEntries([
    ["default", localize("scbr.settings.language.default", "Follow Foundry")],
    ...SUPPORTED_UI_LANGUAGES.map((language) => {
      const fallback = language === "de" ? "Deutsch" : language === "en" ? "English" : language;
      return [
        language,
        localize(`scbr.settings.language.${language}`, fallback)
      ];
    })
  ]);
}

function getThemeSettingChoices() {
  return {
    signature: localize("scbr.settings.theme.signature", "Signature"),
    foundry: localize("scbr.settings.theme.foundry", "Foundry Default")
  };
}

function getFilteredEntries(entries, { documentType, documentId }) {
  return entries.filter((entry) => {
    if (entry.backup.documentType !== documentType) return false;
    if (documentId && entry.backup.documentId !== documentId) return false;
    return true;
  });
}

function getSelectedDocument(documentType, documentId) {
  if (!documentId) return null;
  return getDocumentCollection(documentType)?.get(documentId) ?? null;
}

function getSelectedDocumentName(documentType, documentId, entries) {
  const document = getSelectedDocument(documentType, documentId);
  if (document) return getDocumentDisplayName(document);
  const entry = entries.find((currentEntry) => currentEntry.backup.documentType === documentType && currentEntry.backup.documentId === documentId);
  return entry?.backup.documentName ?? getDocumentTypeLabel(documentType);
}

function getUnifiedDialogState({ documentType, documentId, entries }) {
  const typeLabel = getDocumentTypeLabel(documentType);
  const filteredEntries = getFilteredEntries(entries, { documentType, documentId });
  const selectedDocument = getSelectedDocument(documentType, documentId);
  const selectedDocumentName = documentId ? getSelectedDocumentName(documentType, documentId, entries) : typeLabel;

  let title = selectedDocumentName;
  let summary = localize("scbr.manager.hint", "Choose a backup to restore it or delete it.");
  let sectionLabel = localize("scbr.manager.selectionLabel", "Saved backups");

  if (selectedDocument) {
    const summaryData = getDocumentBackupSummary(selectedDocument);
    summary = summaryData
      ? format("scbr.dialog.summary.latest", { latest: formatBackupLabel(summaryData.latest) }, `Latest backup: ${formatBackupLabel(summaryData.latest)}.`)
      : localize("scbr.dialog.summary.noneShort", "Create the first backup for this document.");
  } else if (documentId) {
    summary = format("scbr.recovery.list.hintDocument", { documentName: selectedDocumentName }, `Deleted document backups for ${selectedDocumentName}.`);
  } else {
    summary = format("scbr.recovery.list.hintType", { documentType: typeLabel }, `All backups for ${typeLabel}.`);
    title = typeLabel;
    sectionLabel = format("scbr.recovery.list.label", { documentType: typeLabel }, `${typeLabel} backups`);
  }

  return {
    typeLabel,
    filteredEntries,
    selectedDocument,
    selectedDocumentName,
    title,
    summary,
    sectionLabel
  };
}

function buildBackupRows(entries, { includeDocumentDetails=false, recoveryMode=false } = {}) {
  if (!entries.length) {
    return `
      <div class="scbr-empty-state">
        <div class="scbr-empty-icon"><i class="fas fa-box-open"></i></div>
        <div class="scbr-empty-title">${escapeHtml(localize("scbr.manager.emptyTitle", "No backups yet"))}</div>
        <p class="scbr-empty-copy">${escapeHtml(localize("scbr.manager.empty", "No document backups are available yet."))}</p>
      </div>
    `;
  }

  const deleteTooltip = foundry.utils.escapeHTML(localize("scbr.action.remove", "Delete Backup"));

  return `
    <div class="scbr-backup-list">
      ${entries.map((entry) => {
        const primaryAction = getEntryPrimaryAction(entry, { recoveryMode });
        const parts = getBackupDisplayParts(entry.backup);
        const typeLabel = getDocumentTypeLabel(entry.backup.documentType);
        const documentLabel = entry.backup.documentName;
        const stateLabel = entry.document
          ? localize("scbr.manager.available", "Available")
          : localize("scbr.manager.missing", "[deleted]");
        const stateClass = entry.document ? "is-available" : "is-missing";
        const primaryButton = primaryAction
          ? `<button type="button" class="scbr-inline-action is-primary" data-backup-action="${foundry.utils.escapeHTML(primaryAction.action)}" data-document-id="${foundry.utils.escapeHTML(entry.backup.documentId ?? "")}" data-document-type="${foundry.utils.escapeHTML(entry.backup.documentType ?? "")}" data-backup-id="${foundry.utils.escapeHTML(entry.backup.id)}" aria-label="${foundry.utils.escapeHTML(primaryAction.tooltip)}" title="${foundry.utils.escapeHTML(primaryAction.tooltip)}"><i class="${primaryAction.icon}"></i></button>`
          : "";

        return `
          <div class="scbr-backup-row ${stateClass}" data-document-type="${escapeHtml(entry.backup.documentType ?? "")}" data-document-id="${escapeHtml(entry.backup.documentId ?? "")}">
            <div class="scbr-backup-main">
              <div class="scbr-backup-line">
                <span class="scbr-backup-title">${escapeHtml(parts.name)}</span>
                <span class="scbr-pill is-type">${escapeHtml(typeLabel)}</span>
                ${includeDocumentDetails ? `<span class="scbr-backup-doc">${escapeHtml(documentLabel)}</span>` : ""}
                <span class="scbr-backup-time">${escapeHtml(parts.timestamp)}</span>
                <span class="scbr-pill ${stateClass}">${escapeHtml(stateLabel)}</span>
              </div>
            </div>
            <div class="scbr-actions">
              ${primaryButton}
              <button type="button" class="scbr-inline-action" data-backup-action="delete" data-document-id="${foundry.utils.escapeHTML(entry.backup.documentId ?? "")}" data-document-type="${foundry.utils.escapeHTML(entry.backup.documentType ?? "")}" data-backup-id="${foundry.utils.escapeHTML(entry.backup.id)}" aria-label="${deleteTooltip}" title="${deleteTooltip}">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function attachInlineBackupActions(dialog, onAction) {
  dialog.element.querySelectorAll(".scbr-inline-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const actionButton = event.currentTarget;
      onAction({
        action: actionButton.dataset.backupAction,
        documentId: actionButton.dataset.documentId,
        documentType: actionButton.dataset.documentType,
        backupId: actionButton.dataset.backupId
      });
    });
  });
}

function updateUnifiedDialogFilter(dialog, state, entries) {
  const derived = getUnifiedDialogState({
    documentType: state.documentType,
    documentId: state.documentId,
    entries
  });
  const visibleRows = Array.from(dialog.element.querySelectorAll(".scbr-backup-row"));
  let visibleCount = 0;

  for (const row of visibleRows) {
    const matches = row.dataset.documentType === state.documentType && (!state.documentId || row.dataset.documentId === state.documentId);
    row.hidden = !matches;
    if (matches) visibleCount += 1;
  }

  const emptyState = dialog.element.querySelector(".scbr-filter-empty");
  if (emptyState) emptyState.hidden = visibleCount > 0;
  const emptyCopy = dialog.element.querySelector(".scbr-filter-empty .scbr-empty-copy");
  if (emptyCopy) {
    emptyCopy.textContent = state.documentId
      ? format("scbr.recovery.list.emptyDocument", { documentName: derived.selectedDocumentName }, `No backups exist for ${derived.selectedDocumentName}.`)
      : format("scbr.recovery.list.empty", { documentType: derived.typeLabel }, `No backups exist for ${derived.typeLabel}.`);
  }

  const heading = dialog.element.querySelector(".scbr-dynamic-title");
  if (heading) heading.textContent = derived.title;

  const sectionLabel = dialog.element.querySelector(".scbr-dynamic-section-label");
  if (sectionLabel) {
    sectionLabel.textContent = derived.sectionLabel;
  }

  const summary = dialog.element.querySelector(".scbr-summary");
  if (summary) summary.textContent = derived.summary;

  const countLabel = dialog.element.querySelector(".scbr-dynamic-count");
  if (countLabel) countLabel.textContent = String(visibleCount);

  const windowTitle = dialog.element.querySelector(".window-title");
  if (windowTitle) {
    windowTitle.textContent = state.documentId
      ? `${localize("scbr.dialog.title", "Sephral’s Content Backup & Restore")} - ${derived.title}`
      : `${localize("scbr.dialog.title", "Sephral’s Content Backup & Restore")} - ${derived.typeLabel}`;
  }

  const documentSelect = dialog.element.querySelector(".scbr-document-select");
  if (documentSelect) {
    documentSelect.innerHTML = getDocumentPickerOptions(state.documentType, state.documentId, state.contextDocument ?? null);
    documentSelect.value = state.documentId ?? "";
  }

  const backupButton = Array.from(dialog.element.querySelectorAll(".form-footer button")).find((button) => button.textContent?.includes(localize("scbr.action.backup", "Create Backup")));
  if (backupButton) {
    backupButton.disabled = !derived.selectedDocument;
  }
}

async function waitForBackupDialog({ title, content, buttons, dialogClass="scbr-dialog", width=1080, height=null, autoHeight=false, onRender=null }) {
  ensureStylesLoaded();
  let inlineResult = null;

  return foundry.applications.api.DialogV2.wait({
    window: {
      title,
      positioned: true
    },
    content,
    buttons,
    modal: true,
    rejectClose: false,
    close: () => inlineResult,
    render: (_event, dialog) => {
      const resolvedHeight = height ?? Math.min(window.innerHeight - 48, 860);
      dialog.element.classList.add(...String(dialogClass).split(/\s+/).filter(Boolean));
      applyDialogTheme(dialog.element);
      dialog.element.style.setProperty("width", `${width}px`, "important");
      dialog.element.style.setProperty("max-width", "calc(100vw - 32px)", "important");
      dialog.element.style.setProperty("max-height", "calc(100vh - 32px)", "important");
      if (autoHeight) {
        dialog.element.style.removeProperty("height");
        if (typeof dialog.setPosition === "function") {
          dialog.setPosition({ width });
        }
      } else {
        dialog.element.style.setProperty("height", `${resolvedHeight}px`, "important");
        if (typeof dialog.setPosition === "function") {
          dialog.setPosition({ width, height: resolvedHeight });
        }
      }
      if (typeof onRender === "function") {
        onRender(dialog);
      }
      attachInlineBackupActions(dialog, (result) => {
        inlineResult = result;
        dialog.close();
      });
    }
  });
}

function buildUnifiedToolbar(state) {
  return `
    <div class="scbr-toolbar is-wide">
      <label class="scbr-filter-label" for="scbr-type-select">${escapeHtml(localize("scbr.recovery.type.label", "Document type"))}</label>
      <select id="scbr-type-select" class="scbr-select scbr-type-select" name="documentType">${buildRecoveryTypeOptions(state.documentType)}</select>
      <label class="scbr-filter-label" for="scbr-document-select">${escapeHtml(localize("scbr.filter.document.label", "Document"))}</label>
      <select id="scbr-document-select" class="scbr-select scbr-document-select" name="documentId">${getDocumentPickerOptions(state.documentType, state.documentId, state.contextDocument ?? null)}</select>
    </div>
  `;
}

async function openBackupToolDialog({ document=null } = {}) {
  await ensureModuleTranslationsLoaded();
  const initialType = document ? getDocumentType(document) : await promptForRecoveryType();
  const state = {
    documentType: initialType,
    documentId: document?.id ?? "",
    contextDocument: document ?? null
  };

  while (true) {
    const entries = getManagerEntries();
    const derived = getUnifiedDialogState({
      documentType: state.documentType,
      documentId: state.documentId,
      entries
    });
    const content = buildDialogLayout({
      eyebrow: localize("scbr.dialog.title", "Sephral’s Content Backup & Restore"),
      title: derived.title,
      summary: derived.summary,
      count: derived.filteredEntries.length,
      sectionLabel: derived.sectionLabel,
      sectionHint: localize("scbr.manager.sortHint", "Newest first, actions on the right."),
      toolbarHtml: buildUnifiedToolbar(state),
      rowsHtml: `
        ${buildBackupRows(entries, { includeDocumentDetails: true, recoveryMode: true })}
        <div class="scbr-empty-state scbr-filter-empty"${derived.filteredEntries.length ? " hidden" : ""}>
          <div class="scbr-empty-icon"><i class="fas fa-box-open"></i></div>
          <div class="scbr-empty-title">${escapeHtml(localize("scbr.manager.emptyTitle", "No backups yet"))}</div>
          <p class="scbr-empty-copy">${escapeHtml(state.documentId
            ? format("scbr.recovery.list.emptyDocument", { documentName: derived.selectedDocumentName }, `No backups exist for ${derived.selectedDocumentName}.`)
            : format("scbr.recovery.list.empty", { documentType: derived.typeLabel }, `No backups exist for ${derived.typeLabel}.`))}</p>
        </div>
      `
    });

    const result = await waitForBackupDialog({
      title: `${localize("scbr.dialog.title", "Sephral’s Content Backup & Restore")} - ${derived.title}`,
      content,
      dialogClass: "scbr-dialog scbr-document-dialog",
      width: 1180,
      height: 820,
      onRender: (dialog) => {
        const typeSelect = dialog.element.querySelector(".scbr-type-select");
        const documentSelect = dialog.element.querySelector(".scbr-document-select");

        typeSelect?.addEventListener("change", (event) => {
          state.documentType = event.currentTarget.value;
          state.documentId = "";
          updateUnifiedDialogFilter(dialog, state, entries);
        });

        documentSelect?.addEventListener("change", (event) => {
          state.documentId = event.currentTarget.value;
          updateUnifiedDialogFilter(dialog, state, entries);
        });

        updateUnifiedDialogFilter(dialog, state, entries);
      },
      buttons: [
        {
          action: "backup",
          label: localize("scbr.action.backup", "Create Backup"),
          default: !!derived.selectedDocument
        },
        {
          action: "cancel",
          label: localize("scbr.action.cancel", "Cancel")
        }
      ]
    });

    const selectedDocument = getSelectedDocument(state.documentType, state.documentId);
    if (result === "backup") {
      if (!selectedDocument) {
        ui.notifications.warn(localize("scbr.notification.selectDocument", "Select a live document before creating a backup."));
        continue;
      }
      await runDocumentAction(selectedDocument, createBackup);
      continue;
    }

    if (result?.action === "restore" && result.backupId) {
      const entry = entries.find((currentEntry) => currentEntry.backup.id === result.backupId);
      if (entry?.document) {
        await runDocumentAction(entry.document, (currentDocument) => restoreBackup(currentDocument, result.backupId));
      }
      return;
    }

    if (result?.action === "reconstruct" && result.backupId) {
      const entry = entries.find((currentEntry) => currentEntry.backup.id === result.backupId);
      if (entry) {
        await runRecoveryAction(() => reconstructDocumentFromBackup(entry.backup));
      }
      continue;
    }

    if (result?.action === "delete" && result.backupId) {
      await runRecoveryAction(async () => {
        const entry = entries.find((currentEntry) => currentEntry.backup.id === result.backupId);
        if (entry) await removeBackupEntry(entry);
      });
      continue;
    }

    return;
  }
}

function getManagerEntries() {
  return getAllBackups().map((backup) => createEntryFromBackup(backup));
}

async function promptForRecoveryType() {
  return getAllBackups()[0]?.documentType ?? SUPPORTED_DOCUMENTS[0]?.documentName ?? "Scene";
}

class BackupToolMenu extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-tool-menu`,
    tag: "div",
    position: {
      width: 1,
      height: 1
    },
    window: {
      frame: false,
      positioned: false,
      minimizable: false
    }
  };

  async _renderHTML() {
    return document.createElement("div");
  }

  _replaceHTML(_result, _content) {}

  async render() {
    await openBackupToolDialog();
    return this;
  }
}

function createContextOption(documentName) {
  return {
    name: localize("scbr.context.label", "Sephral’s Content Backup & Restore"),
    icon: '<i class="fas fa-box-archive"></i>',
    condition: () => game.user.isGM,
    callback: (target) => {
      const documentId = getDocumentIdFromContext(target);
      const document = getDocumentCollection(documentName)?.get(documentId);
      if (!document) {
        ui.notifications.error(localize("scbr.notification.documentMissing", "The selected document could not be found."));
        return;
      }

      openBackupToolDialog({ document });
    }
  };
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  for (const legacyModuleId of LEGACY_MODULE_IDS) {
    game.settings.register(legacyModuleId, STORE_SETTING, {
      scope: "world",
      config: false,
      type: Object,
      default: {
        version: BACKUP_STORAGE_VERSION,
        backups: []
      }
    });
  }

  game.settings.register(MODULE_ID, STORE_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      version: BACKUP_STORAGE_VERSION,
      backups: []
    }
  });

  game.settings.register(MODULE_ID, STORE_LOCK_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      token: null,
      owner: null,
      expiresAt: 0,
      acquiredAt: null
    }
  });

  game.settings.register(MODULE_ID, UI_LANGUAGE_SETTING, {
    scope: "client",
    config: true,
    type: String,
    name: localize("scbr.settings.language.label", "Language"),
    hint: localize("scbr.settings.language.hint", "Use the Foundry language or force this module to one of the supported module languages."),
    choices: getLanguageSettingChoices(),
    default: "default"
  });

  game.settings.register(MODULE_ID, UI_THEME_SETTING, {
    scope: "client",
    config: true,
    type: String,
    name: localize("scbr.settings.theme.label", "Design"),
    hint: localize("scbr.settings.theme.hint", "Switch between the current signature look and a Foundry-style default layout."),
    choices: getThemeSettingChoices(),
    default: "signature"
  });

  game.settings.registerMenu(MODULE_ID, "backupTool", {
    name: localize("scbr.settings.tool.name", "Sephral’s Content Backup & Restore"),
    label: localize("scbr.settings.tool.label", "Open SCBR"),
    hint: localize("scbr.settings.tool.hint", "Open the unified backup dialog for all supported world documents."),
    icon: "fas fa-box-archive",
    type: BackupToolMenu,
    restricted: true
  });

});

Hooks.once("ready", async () => {
  await ensureModuleTranslationsLoaded();
  await migrateLegacyBackups();
});

for (const config of SUPPORTED_DOCUMENTS) {
  Hooks.on(`get${config.documentName}ContextOptions`, (_application, contextOptions) => {
    contextOptions.push(createContextOption(config.documentName));
  });
}

export const __test__ = {
  MODULE_ID,
  LEGACY_MODULE_IDS,
  STORE_SETTING,
  STORE_LOCK_SETTING,
  UI_LANGUAGE_SETTING,
  UI_THEME_SETTING,
  LEGACY_FLAG,
  LEGACY_SCENE_BACKUP_FLAG,
  BACKUP_STORAGE_VERSION,
  SUPPORTED_UI_LANGUAGES,
  DEFAULT_UI_LANGUAGE,
  MODULE_TRANSLATION_CACHE,
  LEGACY_STORAGE_ROOT,
  WORLD_STORAGE_ROOT,
  BACKUP_LOCK_TIMEOUT_MS,
  BACKUP_LOCK_RETRY_MS,
  SUPPORTED_DOCUMENTS,
  localize,
  format,
  interpolateTemplate,
  getRegisteredSettingValue,
  getPreferredLanguage,
  normalizeUiLanguage,
  getModuleLanguage,
  loadModuleTranslations,
  ensureModuleTranslationsLoaded,
  resetModuleTranslationState,
  getThemePreference,
  getLocaleForModule,
  getDocumentType,
  getSupportedDocumentConfig,
  getDocumentCollection,
  getDocumentTypeLabel,
  getDocumentDisplayName,
  getTimestampString,
  formatBackupLabel,
  escapeHtml,
  getBackupDisplayParts,
  ensureStylesLoaded,
  applyDialogTheme,
  sanitizePathSegment,
  getWorldStorageRoot,
  getLegacyWorldStorageRoot,
  getStorageRoots,
  normalizeStoragePath,
  sleep,
  getDocumentTypeStoragePath,
  parseBackupPath,
  buildBackupStoragePath,
  sortBackups,
  getRootedStoragePath,
  getBackupFetchUrl,
  getBackupFileName,
  getBackupDirectoryPath,
  acquireBackupStoreLock,
  releaseBackupStoreLock,
  withBackupStoreLock,
  ensureStorageDirectoryExists,
  writeBackupFile,
  readBackupFile,
  deleteBackupFile,
  normalizeBackupIndex,
  normalizeBackup,
  getStoredBackupSetting,
  getBackupStore,
  getEmbeddedBackupsFromStore,
  getLegacyBackupStore,
  collectBackupsFromTypeFiles,
  clearBackupStore,
  unsetLegacyDocumentFlag,
  saveBackupStore,
  getAllBackups,
  getBackups,
  getBackupById,
  setBackups,
  getLegacyBackups,
  migrateLegacyBackups,
  getContextDataset,
  getDocumentIdFromContext,
  buildBackupPayload,
  sanitizeFlags,
  buildRestoreData,
  buildReconstructionData,
  getDocumentBackupSummary,
  resolveDocumentForBackup,
  createEntryFromBackup,
  promptForBackupName,
  createBackup,
  restoreBackup,
  reconstructDocumentFromBackup,
  removeBackupByEntry,
  removeBackup,
  removeBackupEntry,
  runDocumentAction,
  runRecoveryAction,
  getEntryPrimaryAction,
  getDocumentPickerOptions,
  buildRecoveryTypeOptions,
  buildDialogLayout,
  getLanguageSettingChoices,
  getThemeSettingChoices,
  getFilteredEntries,
  getSelectedDocument,
  getSelectedDocumentName,
  getUnifiedDialogState,
  buildBackupRows,
  attachInlineBackupActions,
  updateUnifiedDialogFilter,
  waitForBackupDialog,
  buildUnifiedToolbar,
  openBackupToolDialog,
  getManagerEntries,
  promptForRecoveryType,
  BackupToolMenu,
  createContextOption
};
