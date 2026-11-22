// Sample windows (api.samples, contract in samples.mjs): the windows, questions and chat cards of the module filled with
// made-up backups and encounter states, so translators and testers see every text in its place without saving anything
// first. Nothing here writes: the lists are built in memory, no backup file is made, nothing is restored, the settings
// stay untouched, and every button in the windows only says that it does nothing.
import { buildMeta } from "./encounter-state.mjs";
import { openSampleChat, openSampleHtml, sampleText } from "./samples.mjs";

export const SAMPLE_MODULE_ID = "sephrals-content-backup-restore";
const HOUR = 60 * 60 * 1000;

/* -------------------------------------------- */
/*  The sample data (pure, no Foundry needed)    */
/* -------------------------------------------- */

/**
 * Made-up backups of a few documents. A document that is not `live` was deleted from the sample world. One backup was
 * made with an older Foundry and system, so the restore question can show its version warning.
 * @param {{now?: number, world?: object, text?: (key: string) => string, label?: (key: string) => string}} options
 * @returns {{backup: object, document: object|null}[]}  newest first
 */
export function sampleBackups({ now = Date.now(), world = {}, text = (key) => key, label = (key) => key } = {}) {
  const older = {
    coreGeneration: world.coreGeneration != null ? Number(world.coreGeneration) - 1 : 13,
    coreBuild: null,
    systemId: world.systemId ?? "dnd5e",
    systemVersion: "5.1.0"
  };
  const env = { coreGeneration: world.coreGeneration ?? null, coreBuild: world.coreBuild ?? null, systemId: world.systemId ?? null, systemVersion: world.systemVersion ?? null };
  const make = (id, name, documentType, documentId, documentName, hoursAgo, environment = env) => ({
    id: `scbr-sample-${id}`, name, documentType, documentId: `sample${documentId}`, documentName,
    createdAt: new Date(now - hoursAgo * HOUR).toISOString(), path: `sample/${id}.json`, ...environment
  });
  const mill = text("place");
  const list = [
    [make("mill-1", label("scbr.sample.nameBeforeFight"), "Scene", "Mill", mill, 2), true],
    [make("mill-2", label("scbr.backup.safetyName"), "Scene", "Mill", mill, 26), true],
    [make("mill-3", label("scbr.sample.nameTidied"), "Scene", "Mill", mill, 50, older), true],
    // a backup without a name and a date (old or damaged entries), the list shows "Unnamed Backup" and "No timestamp"
    [{ ...make("mill-0", "", "Scene", "Mill", mill, 0), createdAt: "" }, true],
    [make("cave-1", label("scbr.sample.nameBeforeFight"), "Scene", "Cave", label("scbr.sample.docCave"), 120), false],
    [make("ari-1", "Ari", "Actor", "Ari", "Ari", 5), true],
    [make("ari-2", label("scbr.backup.safetyName"), "Actor", "Ari", "Ari", 77), true],
    [make("mira-1", "Mira", "Actor", "Mira", "Mira", 30), true],
    [make("troll-1", text("troll"), "Actor", "Troll", text("troll"), 100), false],
    [make("notes-1", label("scbr.sample.nameTidied"), "JournalEntry", "Notes", label("scbr.sample.docNotes"), 9), true]
  ];
  return list
    .map(([backup, live]) => ({ backup, document: live ? { id: backup.documentId, name: backup.documentName, documentName: backup.documentType } : null }))
    .sort((a, b) => b.backup.createdAt.localeCompare(a.backup.createdAt));
}

/**
 * Made-up encounter snapshots as the list shows them (index entries), newest first. The last one belongs to a scene that
 * no longer exists.
 */
export function sampleSnapshots({ now = Date.now(), world = {}, text = (key) => key, label = (key) => key } = {}) {
  const env = { coreGeneration: world.coreGeneration ?? null, coreBuild: world.coreBuild ?? null, systemId: world.systemId ?? null, systemVersion: world.systemVersion ?? null };
  const filler = (count) => Array.from({ length: count }, (_, index) => ({ _id: `x${index}` }));
  const make = ({ id, kind, name, hoursAgo, scene, sceneId, tokens, actors, effects, doors, lights, sounds, round }) => ({
    ...buildMeta({
      id, kind, name, combatName: text("troll"),
      createdAt: new Date(now - hoursAgo * HOUR).toISOString(),
      saved: {
        scene: { id: sceneId, name: scene },
        combat: { id: `${id}-combat`, round },
        tokens: filler(tokens),
        actors: filler(actors).map((actor, index) => ({ ...actor, effects: filler(index === 0 ? effects : 0) })),
        walls: filler(doors), lights: filler(lights), sounds: filler(sounds)
      }
    }),
    ...env
  });
  const mill = text("place");
  return [
    make({ id: "sample-a", kind: "start", name: label("scbr.encounter.kind.start"), hoursAgo: 1, scene: mill, sceneId: "sampleMill", tokens: 8, actors: 8, effects: 2, doors: 3, lights: 4, sounds: 1, round: 1 }),
    make({ id: "sample-b", kind: "safety", name: label("scbr.encounter.kind.safety"), hoursAgo: 20, scene: mill, sceneId: "sampleMill", tokens: 9, actors: 8, effects: 0, doors: 3, lights: 4, sounds: 0, round: 3 }),
    make({ id: "sample-c", kind: "manual", name: label("scbr.sample.nameBeforeTroll"), hoursAgo: 48, scene: mill, sceneId: "sampleMill", tokens: 6, actors: 6, effects: 1, doors: 2, lights: 2, sounds: 1, round: 2 }),
    make({ id: "sample-d", kind: "start", name: label("scbr.encounter.kind.start"), hoursAgo: 170, scene: label("scbr.sample.docCave"), sceneId: "sampleGone", tokens: 5, actors: 5, effects: 0, doors: 1, lights: 3, sounds: 0, round: 1 })
  ];
}

/** What a reset would change, in the shape `summarizePlan` gives. `full` adds the notes about kept tokens and missing characters. */
export function sampleSummary({ full = false } = {}) {
  return {
    tokensMoved: 5, tokensRestored: 1, tokensRemoved: full ? 2 : 0, tokensAdded: full ? 0 : 2,
    actors: 4, actorsValues: 4, items: 3, effectsRemoved: 1, effectsRestored: full ? 1 : 0, effectsChanged: full ? 1 : 0,
    doors: 2, lights: full ? 1 : 0, combat: 1, combatants: 3, soundsStarted: 1, soundsStopped: full ? 1 : 0,
    missingActors: full ? 1 : 0, empty: false
  };
}

/* -------------------------------------------- */
/*  Window pieces                               */
/* -------------------------------------------- */

// The framed dialog the module opens, rebuilt around its own content builders: content and footer buttons.
function dialogShell(h, content, buttons = []) {
  const footer = buttons.map((button) => `<button type="button" data-action="sample"${button.default ? ' class="default"' : ""}${button.disabled ? " disabled" : ""}>${h.escapeHtml(button.label)}</button>`).join("");
  return `<form class="dialog-form standard-form"><div class="dialog-content standard-form scrollable">${content}</div>${footer ? `<footer class="form-footer">${footer}</footer>` : ""}</form>`;
}

async function openDialog(h, { id, title, content, buttons, width = 720, classes = [] }) {
  const app = await openSampleHtml({
    moduleId: SAMPLE_MODULE_ID, id, title, width, classes,
    body: async () => {
      await h.ensureTranslations();
      const html = typeof content === "function" ? await content() : content;
      return dialogShell(h, html, typeof buttons === "function" ? buttons() : buttons);
    }
  });
  // the theme of the module's windows (signature or Foundry), as the real dialog sets it
  if (classes.includes("scbr-dialog")) h.applyDialogTheme(app.element);
  app.element?.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
  return app;
}

function typeOptions(h, entries, selected) {
  const counts = new Map();
  for (const { backup } of entries) counts.set(backup.documentType, (counts.get(backup.documentType) ?? 0) + 1);
  const types = counts.size ? [...counts.keys()] : [selected];
  return types.map((type) => `<option value="${type}"${type === selected ? " selected" : ""}>${h.escapeHtml(`${h.getDocumentTypeLabel(type)} (${counts.get(type) ?? 0})`)}</option>`).join("");
}

function documentOptions(h, entries, type, selectedId, extraName = "") {
  const seen = new Map();
  for (const { backup, document } of entries) if (backup.documentType === type && !seen.has(backup.documentId)) seen.set(backup.documentId, { name: backup.documentName, deleted: !document });
  if (selectedId && extraName && !seen.has(selectedId)) seen.set(selectedId, { name: extraName, deleted: false });
  const all = h.format("scbr.filter.document.all", { documentType: h.getDocumentTypePluralLabel(type) }, `All ${type}`);
  const options = [...seen.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, option]) => {
    const suffix = option.deleted ? ` ${h.localize("scbr.manager.missing", "[deleted]")}` : "";
    return `<option value="${h.escapeHtml(id)}"${id === selectedId ? " selected" : ""}>${h.escapeHtml(`${option.name}${suffix}`)}</option>`;
  });
  return [`<option value="">${h.escapeHtml(all)}</option>`, ...options].join("");
}

/**
 * The backup window for one state of its filter: the whole list of a type, one document, a deleted document, a document
 * without backups, or no backups at all. `documentName` names a document the sample list does not hold.
 */
function backupWindow(h, entries, { type, documentId = "", documentName = "" }) {
  const typeLabel = h.getDocumentTypeLabel(type);
  const inType = entries.filter((entry) => entry.backup.documentType === type && (!documentId || entry.backup.documentId === documentId));
  const selected = entries.find((entry) => entry.backup.documentId === documentId && entry.backup.documentType === type);
  let name = typeLabel;
  let summary;
  let sectionLabel = h.localize("scbr.manager.selectionLabel", "Saved backups");
  let canBackup = false;
  if (documentId) {
    name = selected?.backup.documentName ?? documentName ?? typeLabel;
    if (selected && !selected.document) {
      summary = h.format("scbr.recovery.list.hintDocument", { documentName: name }, `Deleted document backups for ${name}.`);
    } else {
      canBackup = true;
      const latest = inType[0]?.backup;
      summary = latest
        ? h.format("scbr.dialog.summary.latest", { latest: h.formatBackupLabel(latest) }, `Latest backup: ${h.formatBackupLabel(latest)}.`)
        : h.localize("scbr.dialog.summary.noneShort", "Create the first backup for this document.");
    }
  } else {
    summary = h.format("scbr.recovery.list.hintType", { documentType: h.getDocumentTypePluralLabel(type) }, `All backups for ${type}.`);
    sectionLabel = h.format("scbr.recovery.list.label", { documentType: typeLabel }, `${typeLabel} backups`);
  }
  const filterEmpty = entries.length > 0 && !inType.length;
  const toolbar = `<div class="scbr-toolbar is-wide">
      <label class="scbr-filter-label">${h.escapeHtml(h.localize("scbr.recovery.type.label", "Document type"))}</label>
      <select class="scbr-select scbr-type-select">${typeOptions(h, entries, type)}</select>
      <label class="scbr-filter-label">${h.escapeHtml(h.localize("scbr.filter.document.label", "Document"))}</label>
      <select class="scbr-select scbr-document-select">${documentOptions(h, entries, type, documentId, documentName)}</select>
    </div>`;
  const emptyCopy = documentId
    ? h.format("scbr.recovery.list.emptyDocument", { documentName: name }, `No backups exist for ${name}.`)
    : h.format("scbr.recovery.list.empty", { documentType: h.getDocumentTypePluralLabel(type) }, `No backups exist for ${type}.`);
  const rows = filterEmpty
    ? `<div class="scbr-empty-state scbr-filter-empty"><div class="scbr-empty-icon"><i class="fas fa-box-open"></i></div>
        <div class="scbr-empty-title">${h.escapeHtml(h.localize("scbr.manager.emptyTitle", "No backups yet"))}</div>
        <p class="scbr-empty-copy">${h.escapeHtml(emptyCopy)}</p></div>`
    : h.buildBackupRows(inType, { includeDocumentDetails: true, recoveryMode: true });
  const html = h.buildDialogLayout({
    eyebrow: h.localize("scbr.dialog.title", "Sephral’s Content Backup & Restore"),
    title: name, summary, count: inType.length, sectionLabel,
    sectionHint: h.localize("scbr.manager.sortHint", "Newest first, actions on the right."),
    toolbarHtml: toolbar, rowsHtml: rows
  });
  const buttons = [
    { label: h.localize("scbr.action.backup", "Create Backup"), default: canBackup, disabled: !canBackup },
    { label: h.localize("scbr.encounter.action.open", "Encounter states") },
    { label: h.localize("scbr.action.cancel", "Cancel") }
  ];
  return { html, buttons, title: `${h.localize("scbr.dialog.title", "Sephral’s Content Backup & Restore")} - ${name}` };
}

const confirmButtons = (h, yesKey, yesFallback) => [
  { label: h.localize(yesKey, yesFallback), default: true },
  { label: h.localize("scbr.action.cancel", "Cancel") }
];

/* -------------------------------------------- */
/*  The entries                                 */
/* -------------------------------------------- */

/**
 * The sample windows of the module (api.samples).
 * @param {object} h   helpers of scbr.js: the dialog content builders, localize, the encounter service and ui
 * @returns {{id: string, label: string, group: string, open: () => Promise<object>}[]}
 */
export function sampleWindows(h) {
  const L = (key) => h.localize(key, key);
  const world = () => h.getWorldEnvironment();
  const data = () => ({ now: Date.now(), world: world(), text: sampleText, label: L });
  const backups = () => sampleBackups(data());
  const snapshots = () => sampleSnapshots(data());
  const title = L("scbr.dialog.title");
  const groups = {
    windows: L("scbr.sample.groupWindows"),
    questions: L("scbr.sample.groupQuestions"),
    encounters: L("scbr.sample.groupEncounters"),
    chat: L("scbr.sample.groupChat")
  };
  const entries = [];
  const add = (id, group, label, open) => entries.push({ id, group, label, open: async () => {
    await h.ensureTranslations();
    return open(label);
  } });

  // The backup window in its states
  const listWindow = (id, label, state, entriesFor = backups) => add(id, groups.windows, label, () => openDialog(h, {
    id, title: backupWindow(h, entriesFor(), state).title, width: 1000, classes: ["scbr-dialog", "scbr-document-dialog"],
    content: () => backupWindow(h, entriesFor(), state).html,
    buttons: () => backupWindow(h, entriesFor(), state).buttons
  }));
  listWindow("list-all", `${title}: ${L("scbr.sample.listAll")}`, { type: "Scene" });
  listWindow("list-document", `${title}: ${L("scbr.sample.listDocument")}`, { type: "Scene", documentId: "sampleMill" });
  listWindow("list-deleted", `${title}: ${L("scbr.sample.listDeleted")}`, { type: "Actor", documentId: "sampleTroll" });
  listWindow("list-none", `${title}: ${L("scbr.sample.listNone")}`, { type: "Scene", documentId: "sampleHall", documentName: L("scbr.sample.docHall") });
  listWindow("list-empty", `${title}: ${L("scbr.sample.listEmpty")}`, { type: "Scene" }, () => []);

  // The questions
  const mill = () => ({ id: "sampleMill", name: sampleText("place"), documentName: "Scene" });
  const millBackup = (index = 0) => backups().filter((entry) => entry.backup.documentId === "sampleMill")[index].backup;
  const question = (id, label, content, yesKey, yesFallback, width = 460, titleKey = null) => add(id, groups.questions, label, () => openDialog(h, {
    id, title: titleKey ? L(titleKey) : label, width, content, buttons: () => confirmButtons(h, yesKey, yesFallback)
  }));
  add("create", groups.questions, L("scbr.dialog.create.title"), () => openDialog(h, {
    id: "create", title: L("scbr.dialog.create.title"), width: 720, classes: ["scbr-dialog", "scbr-create-dialog"],
    content: () => h.buildCreateContent(mill()),
    buttons: () => [{ label: L("scbr.dialog.create.submit"), default: true }, { label: L("scbr.action.cancel") }]
  }));
  question("restore", L("scbr.dialog.restoreConfirm.title"), () => h.buildRestoreConfirmContent(mill(), millBackup(0), { safetyBackup: true }), "scbr.dialog.restoreConfirm.confirm", "Restore", 460, "scbr.dialog.restoreConfirm.title");
  question("restore-version", `${L("scbr.dialog.restoreConfirm.title")} (${L("scbr.sample.otherVersion")})`, () => h.buildRestoreConfirmContent(mill(), millBackup(2), { safetyBackup: true }), "scbr.dialog.restoreConfirm.confirm", "Restore", 460, "scbr.dialog.restoreConfirm.title");
  question("restore-no-safety", `${L("scbr.dialog.restoreConfirm.title")} (${L("scbr.sample.noSafety")})`, () => h.buildRestoreConfirmContent(mill(), millBackup(0), { safetyBackup: false }), "scbr.dialog.restoreConfirm.confirm", "Restore", 460, "scbr.dialog.restoreConfirm.title");
  question("delete", L("scbr.dialog.deleteConfirm.title"), () => h.buildDeleteConfirmContent(millBackup(1), sampleText("place")), "scbr.dialog.deleteConfirm.confirm", "Delete", 420, "scbr.dialog.deleteConfirm.title");
  question("missing-file", L("scbr.dialog.missingFile.title"), () => h.buildMissingFileContent(millBackup(0), sampleText("place")), "scbr.dialog.missingFile.confirm", "Remove Entry", 480, "scbr.dialog.missingFile.title");

  // Encounter states: the list, the questions and what the tracker shows
  const manager = (id, label, list) => add(id, groups.encounters, label, () => openDialog(h, {
    id, title: `${title} - ${L("scbr.encounter.manager.title")}`, width: 1000, classes: ["scbr-dialog", "scbr-document-dialog", "scbr-encounter-dialog"],
    content: () => h.encounterUi.managerContent(list(), (meta) => meta.sceneId !== "sampleGone"),
    buttons: () => [{ label: L("scbr.encounter.manager.save"), default: true }, { label: L("scbr.encounter.manager.back") }]
  }));
  manager("encounters", L("scbr.encounter.manager.title"), snapshots);
  manager("encounters-empty", `${L("scbr.encounter.manager.title")} (${L("scbr.sample.listEmpty")})`, () => []);
  const reset = (id, label, build) => add(id, groups.encounters, label, () => openDialog(h, {
    id, title: L("scbr.encounter.confirm.title"), width: 520, content: build, buttons: () => confirmButtons(h, "scbr.encounter.confirm.yes", "Reset")
  }));
  reset("reset", L("scbr.encounter.confirm.title"), () => h.encounterService.confirmContent(snapshots()[0], sampleSummary(), { safety: true }));
  reset("reset-more", `${L("scbr.encounter.confirm.title")} (${L("scbr.sample.resetMore")})`, () => h.encounterService.confirmContent(
    { ...snapshots()[2], coreGeneration: Number(world().coreGeneration ?? 14) - 1, systemVersion: "5.1.0" }, sampleSummary({ full: true }), { safety: false }));
  add("save-name", groups.encounters, L("scbr.encounter.save.title"), () => openDialog(h, {
    id: "save-name", title: L("scbr.encounter.save.title"), width: 460,
    content: () => h.encounterUi.nameContent(h.encounterService.snapshotTitle("manual")),
    buttons: () => [{ label: L("scbr.encounter.save.confirm"), default: true }]
  }));
  add("snapshot-delete", groups.encounters, L("scbr.encounter.delete.title"), () => openDialog(h, {
    id: "snapshot-delete", title: L("scbr.encounter.delete.title"), width: 420, content: () => h.encounterUi.deleteContent(),
    buttons: () => [{ label: L("scbr.sample.yes"), default: true }, { label: L("scbr.sample.no") }]
  }));
  // The two buttons of the combat tracker (saved state there or not) and the entries of its menu, made by the module's own code
  add("tracker", groups.encounters, L("scbr.sample.tracker"), (label) => openSampleHtml({
    moduleId: SAMPLE_MODULE_ID, id: "tracker", title: label, width: 460,
    body: async () => {
      await h.ensureTranslations();
      const root = document.createElement("div");
      root.className = "scbr-sample-tracker";
      const row = (hasSaved) => {
        const { save, reset: back } = h.encounterUi.trackerButtons({ hasSaved });
        const line = document.createElement("div");
        line.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 0;";
        for (const button of [save, back]) {
          const item = document.createElement("div");
          item.style.cssText = "display:flex;align-items:center;gap:10px;";
          const text = document.createElement("span");
          text.textContent = button.dataset.tooltip;
          item.append(button, text);
          line.append(item);
        }
        return line;
      };
      const menu = [];
      h.encounterUi.addContextEntries({}, menu);
      const list = document.createElement("ul");
      list.style.cssText = "list-style:none;margin:0;padding:6px 0;display:flex;flex-direction:column;gap:6px;";
      for (const entry of menu) {
        const item = document.createElement("li");
        item.innerHTML = `${entry.icon} `;
        item.append(document.createTextNode(entry.label));
        list.append(item);
      }
      root.append(row(true), document.createElement("hr"), row(false), document.createElement("hr"), list);
      return root;
    }
  }));

  // Chat card: the self test, passed and with problems
  const selfTest = (id, label, problems) => add(id, groups.chat, label, () => openSampleChat({
    moduleId: SAMPLE_MODULE_ID, id, title: label, whisper: [game.user.id],
    content: () => {
      const checks = 9;
      const summary = problems.length
        ? h.format("scbr.selfTest.problems", { problems: problems.length, checks }, "")
        : h.format("scbr.selfTest.passed", { checks, backups: backups().length }, "");
      const versions = h.format("scbr.selfTest.version", { current: game.version, tested: game.version }, "");
      return h.buildSelfTestCard({ summary, versions, problems: problems.map((problem) => problem()) });
    }
  }));
  selfTest("self-test-ok", L("scbr.sample.selfPassed"), []);
  selfTest("self-test-failed", L("scbr.sample.selfFailed"), [
    () => h.format("scbr.selfTest.collections", { types: "Scene, Actor" }, ""),
    () => h.format("scbr.selfTest.storage", { folder: "scbr" }, ""),
    () => h.format("scbr.selfTest.index", {}, ""),
    () => h.format("scbr.selfTest.files", { count: 2 }, ""),
    () => h.format("scbr.selfTest.encounterIndex", {}, ""),
    () => h.format("scbr.selfTest.encounterFile", {}, ""),
    () => h.format("scbr.selfTest.lock", {}, "")
  ]);
  return entries;
}

export const __test__ = { sampleBackups, sampleSnapshots, sampleSummary };
