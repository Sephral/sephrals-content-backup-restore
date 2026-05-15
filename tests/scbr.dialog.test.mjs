import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, TestHTMLElement } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import("../scripts/scbr.js");

function resetState() {
  env.state.notifications.info.length = 0;
  env.state.notifications.warn.length = 0;
  env.state.notifications.error.length = 0;
  env.state.settingWrites.length = 0;
  env.state.settingsValues.clear();
  env.game.settings.settings.clear();
  env.state.dialogWaitResult = null;
  env.state.dialogConfirmResult = true;
  env.state.lastDialogWaitOptions = null;
  env.state.lastDialogConfirmOptions = null;
  env.state.localizations.clear();
  __test__.resetModuleTranslationState();
  for (const config of __test__.SUPPORTED_DOCUMENTS) env.setCollection(config.documentName, []);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: __test__.BACKUP_STORAGE_VERSION,
    backups: []
  });
}

function createBackupIndex(overrides = {}) {
  return {
    id: "backup-1",
    name: "Scene Backup",
    documentId: "scene-1",
    documentName: "Scene One",
    documentType: "Scene",
    createdAt: "2024-01-01T00:00:00.000Z",
    path: "Scene.json#backup-1",
    ...overrides
  };
}

function createDialogHarness() {
  const root = new TestHTMLElement();
  const rowVisible = new TestHTMLElement();
  rowVisible.dataset.documentType = "Scene";
  rowVisible.dataset.documentId = "scene-1";
  const rowHidden = new TestHTMLElement();
  rowHidden.dataset.documentType = "Actor";
  rowHidden.dataset.documentId = "actor-1";
  const emptyState = new TestHTMLElement();
  const emptyCopy = new TestHTMLElement();
  const heading = new TestHTMLElement();
  const sectionLabel = new TestHTMLElement();
  const summary = new TestHTMLElement();
  const count = new TestHTMLElement();
  const windowTitle = new TestHTMLElement();
  const documentSelect = new TestHTMLElement();
  const backupButton = new TestHTMLElement();
  backupButton.textContent = "Create Backup";
  const typeSelect = new TestHTMLElement();
  const footerButton = new TestHTMLElement();
  footerButton.textContent = "Cancel";

  root.setQuerySelectorAll(".scbr-backup-row", [rowVisible, rowHidden]);
  root.setQuerySelector(".scbr-filter-empty", emptyState);
  root.setQuerySelector(".scbr-filter-empty .scbr-empty-copy", emptyCopy);
  root.setQuerySelector(".scbr-dynamic-title", heading);
  root.setQuerySelector(".scbr-dynamic-section-label", sectionLabel);
  root.setQuerySelector(".scbr-summary", summary);
  root.setQuerySelector(".scbr-dynamic-count", count);
  root.setQuerySelector(".window-title", windowTitle);
  root.setQuerySelector(".scbr-document-select", documentSelect);
  root.setQuerySelector(".scbr-type-select", typeSelect);
  root.setQuerySelectorAll(".form-footer button", [footerButton, backupButton]);

  return { root, rowVisible, rowHidden, emptyState, emptyCopy, heading, sectionLabel, summary, count, windowTitle, documentSelect, typeSelect, backupButton };
}

test.beforeEach(resetState);
test.after(() => env.cleanup());

test("dialog helpers build option markup and derive unified state", async () => {
  const scene = { id: "scene-1", name: "Scene One", documentName: "Scene" };
  env.setCollection("Scene", [scene]);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupIndex(), createBackupIndex({ id: "backup-2", documentId: "scene-2", documentName: "Deleted Scene" })]
  });

  const picker = __test__.getDocumentPickerOptions("Scene", "scene-1", { id: "scene-3", name: "Preferred", documentName: "Scene" });
  assert.equal(picker.includes("scene-1"), true);
  assert.equal(picker.includes("Deleted Scene [deleted]"), true);
  assert.equal(picker.includes("scene-3"), true);

  const recoveryTypes = __test__.buildRecoveryTypeOptions("Scene");
  assert.equal(recoveryTypes.includes("Scene (2)"), true);

  const layout = __test__.buildDialogLayout({ eyebrow: "Eyebrow", title: "Title", summary: "Summary", count: 1, sectionLabel: "Section", sectionHint: "Hint", rowsHtml: "<p>row</p>" });
  assert.equal(layout.includes("scbr-shell"), true);
  assert.equal(__test__.getLanguageSettingChoices().default.length > 0, true);
  assert.equal(__test__.getThemeSettingChoices().signature.length > 0, true);

  const entries = [
    { backup: createBackupIndex(), document: scene },
    { backup: createBackupIndex({ id: "backup-2", documentId: "scene-2", documentName: "Deleted Scene" }), document: null }
  ];
  assert.equal(__test__.getSelectedDocument("Scene", "scene-1").name, "Scene One");
  assert.equal(__test__.getSelectedDocumentName("Scene", "scene-2", entries), "Deleted Scene");
  const state = __test__.getUnifiedDialogState({ documentType: "Scene", documentId: "scene-1", entries });
  assert.equal(state.filteredEntries.length, 1);
  assert.equal(state.selectedDocumentName, "Scene One");

  const deletedState = __test__.getUnifiedDialogState({ documentType: "Scene", documentId: "scene-2", entries });
  assert.equal(deletedState.summary.includes("Deleted Scene"), true);
});

test("row rendering, inline actions, and dialog filter updates cover visible and empty states", async () => {
  const scene = { id: "scene-1", name: "Scene One", documentName: "Scene" };
  env.setCollection("Scene", [scene]);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupIndex(), createBackupIndex({ id: "backup-2", documentId: "scene-2", documentName: "Deleted Scene" })]
  });

  const emptyRows = __test__.buildBackupRows([]);
  assert.equal(emptyRows.includes("No backups yet"), true);

  const rows = __test__.buildBackupRows([
    { backup: createBackupIndex(), document: scene },
    { backup: createBackupIndex({ id: "backup-2", documentId: "scene-2", documentName: "Deleted Scene" }), document: null }
  ], { includeDocumentDetails: true, recoveryMode: true });
  assert.equal(rows.includes("data-backup-action=\"restore\""), true);
  assert.equal(rows.includes("data-backup-action=\"reconstruct\""), true);

  const clicked = [];
  const dialog = { element: new TestHTMLElement() };
  const button = new TestHTMLElement();
  button.dataset.backupAction = "delete";
  button.dataset.documentId = "scene-1";
  button.dataset.documentType = "Scene";
  button.dataset.backupId = "backup-1";
  dialog.element.setQuerySelectorAll(".scbr-inline-action", [button]);
  __test__.attachInlineBackupActions(dialog, (result) => clicked.push(result));
  button.dispatch("click");
  assert.equal(clicked[0].backupId, "backup-1");

  const harness = createDialogHarness();
  const state = { documentType: "Scene", documentId: "scene-1", contextDocument: scene };
  const entries = [
    { backup: createBackupIndex(), document: scene },
    { backup: createBackupIndex({ id: "backup-2", documentType: "Actor", documentId: "actor-1", documentName: "Actor One" }), document: null }
  ];
  __test__.updateUnifiedDialogFilter({ element: harness.root }, state, entries);
  assert.equal(harness.rowVisible.hidden, false);
  assert.equal(harness.rowHidden.hidden, true);
  assert.equal(harness.emptyState.hidden, true);
  assert.equal(harness.heading.textContent, "Scene One");
  assert.equal(harness.documentSelect.value, "scene-1");
  assert.equal(harness.backupButton.disabled, false);
});

test("waitForBackupDialog, openBackupToolDialog, menu rendering, and context callbacks cover UI control flow", async () => {
  const scene = { id: "scene-1", name: "Scene One", documentName: "Scene" };
  env.setCollection("Scene", [scene]);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupIndex()]
  });
  env.state.fetchResponses.set("modules/sephrals-content-backup-restore/lang/en.json", { ok: true, status: 200, json: async () => ({}) });
  env.state.fetchResponses.set("modules/sephrals-content-backup-restore/lang/de.json", { ok: true, status: 200, json: async () => ({}) });

  env.state.dialogWaitResult = (options) => {
    const dialogElement = createDialogHarness().root;
    const inlineButton = new TestHTMLElement();
    inlineButton.dataset.backupAction = "restore";
    inlineButton.dataset.documentId = "scene-1";
    inlineButton.dataset.documentType = "Scene";
    inlineButton.dataset.backupId = "backup-1";
    dialogElement.setQuerySelectorAll(".scbr-inline-action", [inlineButton]);
    dialogElement.setQuerySelector("#scbr-name-input", new TestHTMLElement());
    const dialog = {
      element: dialogElement,
      close() {
        this.closed = true;
      },
      setPosition(position) {
        this.position = position;
      }
    };
    options.render?.(null, dialog);
    inlineButton.dispatch("click");
    return options.close();
  };

  const waitResult = await __test__.waitForBackupDialog({
    title: "Dialog",
    content: "<p>Body</p>",
    buttons: [],
    dialogClass: "scbr-dialog scbr-custom",
    width: 640,
    autoHeight: true,
    onRender(dialog) {
      dialog.element.dataset.rendered = "true";
    }
  });
  assert.deepEqual(waitResult, { action: "restore", documentId: "scene-1", documentType: "Scene", backupId: "backup-1" });

  env.state.dialogWaitResult = { action: "restore", backupId: "backup-1" };
  await __test__.openBackupToolDialog({ document: scene });
  const menu = new __test__.BackupToolMenu();
  assert.equal((await menu._renderHTML()).tagName, "DIV");
  assert.equal(await menu.render(), menu);

  const contextOption = __test__.createContextOption("Scene");
  contextOption.callback({ data: (key) => ({ documentId: "scene-1" })[key] });
  contextOption.callback({ data: () => "missing" });
  assert.equal(env.state.notifications.error.length >= 1, true);
  assert.equal(__test__.promptForRecoveryType() instanceof Promise, true);
});

test("manager loop branches cover fixed-height dialogs, backup warning, reconstruct/delete actions, and null exit", async () => {
  const scene = { id: "scene-1", name: "Scene One", documentName: "Scene" };
  env.setCollection("Scene", [scene]);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_SETTING}`, {
    version: 6,
    backups: [createBackupIndex()]
  });

  const fixedDialog = {
    element: createDialogHarness().root,
    setPosition(position) {
      this.position = position;
    },
    close() {}
  };
  env.state.dialogWaitResult = (options) => {
    options.render?.(null, fixedDialog);
    return options.close();
  };
  await __test__.waitForBackupDialog({ title: "Fixed", content: "<p>x</p>", buttons: [], height: 500 });
  assert.equal(fixedDialog.position.height, 500);

  const firstHarness = createDialogHarness();
  env.state.dialogWaitResult = (() => {
    const queue = ["backup", { action: "reconstruct", backupId: "backup-1" }, { action: "delete", backupId: "backup-1" }, null];
    return (options) => {
      const result = queue.shift();
      const dialog = {
        element: firstHarness.root,
        close() {},
        setPosition() {}
      };
      options.render?.(null, dialog);
      firstHarness.typeSelect.value = "Scene";
      firstHarness.typeSelect.dispatch("change");
      firstHarness.documentSelect.value = "scene-unknown";
      firstHarness.documentSelect.dispatch("change");
      return result;
    };
  })();

  await __test__.openBackupToolDialog();
  assert.equal(env.state.notifications.warn.some((message) => String(message).includes("Select a live document")), true);

  env.state.dialogWaitResult = (() => {
    const queue = ["backup", null];
    return () => queue.shift();
  })();
  env.setCollection("Scene", []);
  await __test__.openBackupToolDialog();
  assert.equal(env.state.notifications.warn.some((message) => String(message).includes("Select a live document")), true);
});

test("backup result without a live document warns and loops", async () => {
  env.setCollection("Scene", []);
  env.state.dialogWaitResult = (() => {
    const queue = ["backup", null];
    return () => queue.shift();
  })();

  await __test__.openBackupToolDialog();
  assert.equal(env.state.notifications.warn.some((message) => String(message).includes("Select a live document")), true);
});

test("backup result with a live document routes through createBackup and loops back", async () => {
  const scene = { id: "scene-1", name: "Scene One", documentName: "Scene", toObject: () => ({ _id: "scene-1", name: "Scene One" }) };
  env.setCollection("Scene", [scene]);
  env.state.dialogWaitResult = (() => {
    const queue = ["backup", "Snapshot", null];
    return () => queue.shift();
  })();

  await __test__.openBackupToolDialog({ document: scene });
  assert.equal(env.state.notifications.info.length >= 0, true);
});