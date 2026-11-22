// Encounter snapshots, the windows: the two buttons in the combat tracker, the entries of its menu and the list in the
// backup window. All actions go through the service (encounter-service.mjs). scbr.js hands in its dialog helpers.

export function createEncounterUi(ctx, service) {
  const { MODULE_ID } = ctx;

  function viewedCombat(app) {
    return app?.viewed ?? game.combats?.viewed ?? game.combat ?? null;
  }

  async function run(action) {
    try {
      return await action();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error?.message ?? String(error));
      return null;
    }
  }

  function nameContent(defaultName) {
    const label = ctx.localize("scbr.encounter.save.nameLabel", "Name of the snapshot");
    return `<div class="form-group"><label>${ctx.escapeHtml(label)}</label><div class="form-fields"><input type="text" name="name" value="${ctx.escapeHtml(defaultName)}" autofocus></div></div>`;
  }

  async function askName(defaultName) {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: ctx.localize("scbr.encounter.save.title", "Save the state of the encounter") },
      content: nameContent(defaultName),
      ok: {
        label: ctx.localize("scbr.encounter.save.confirm", "Save"),
        callback: (_event, button) => button.form.elements.name.value.trim() || defaultName
      },
      rejectClose: false,
      modal: true
    });
    return result ?? null;
  }

  /** Saves the state now (the manual snapshot). `ask` shows the name dialog. */
  async function saveState(combat, { ask = true } = {}) {
    const defaultName = service.snapshotTitle("manual");
    const name = ask ? await askName(defaultName) : defaultName;
    if (name === null) return null;
    const meta = await run(() => service.saveCurrent(combat, { kind: "manual", name }));
    if (!meta) return null;
    ctx.count("encounterSave");
    ui.notifications.info(ctx.format("scbr.encounter.notice.saved", { scene: meta.sceneName }, `Saved the state of the scene '${meta.sceneName}'.`));
    return meta;
  }

  /** Resets to the newest snapshot of the combat. */
  async function resetCombat(combat) {
    const meta = combat ? service.latestForCombat(combat.id) : null;
    if (!meta) {
      ui.notifications.warn(ctx.localize("scbr.encounter.notice.none", "There is no saved state for this combat yet."));
      return null;
    }
    return run(() => service.restoreSnapshot(meta.id));
  }

  function button(icon, label, action) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `inline-control combat-control icon fa-solid ${icon} scbr-encounter-button`;
    el.dataset.scbrAction = action;
    el.dataset.tooltip = label;
    el.setAttribute("aria-label", label);
    return el;
  }

  /** The two buttons of the tracker header. Without a saved state the reset button is dimmed. */
  function trackerButtons({ hasSaved }) {
    const save = button("fa-camera", ctx.localize("scbr.encounter.button.save", "Save the state of the encounter"), "save");
    const reset = button("fa-clock-rotate-left", ctx.localize("scbr.encounter.button.reset", "Back to the saved state"), "reset");
    if (!hasSaved) {
      reset.classList.add("scbr-dimmed");
      reset.dataset.tooltip = ctx.localize("scbr.encounter.button.resetNone", "No saved state for this combat yet");
    }
    return { save, reset };
  }

  /** `renderCombatTracker`: save and reset buttons in the header of the tracker (GM only). */
  function injectTrackerButtons(app, html) {
    if (!game.user?.isGM) return;
    const root = html?.[0] ?? html ?? app?.element;
    const group = root?.querySelector?.(".encounter-controls .control-buttons.right");
    if (!group || group.querySelector(".scbr-encounter-button")) return;
    const combat = viewedCombat(app);
    if (!combat) return;
    const { save, reset } = trackerButtons({ hasSaved: !!service.latestForCombat(combat.id) });
    save.addEventListener("click", (event) => {
      event.preventDefault();
      void saveState(viewedCombat(app));
    });
    reset.addEventListener("click", (event) => {
      event.preventDefault();
      void resetCombat(viewedCombat(app));
    });
    // The spacer next to the menu button makes room for the two buttons.
    group.querySelector(".spacer")?.remove();
    const menu = group.querySelector(".encounter-context-menu");
    if (menu) {
      menu.before(save, reset);
    } else {
      group.append(save, reset);
    }
  }

  /** `getCombatContextOptions`: the same two actions in the menu of the tracker, and the list. */
  function addContextEntries(app, entries) {
    const make = (key, fallback, icon, handler, visible) => {
      const label = ctx.localize(key, fallback);
      const htmlIcon = `<i class="${icon}"></i>`;
      entries.push({
        name: label, label, icon: htmlIcon,
        condition: visible, visible,
        callback: handler, onClick: handler
      });
    };
    const gm = () => game.user?.isGM && !!viewedCombat(app);
    make("scbr.encounter.menu.save", "Save the state of the encounter (SCBR)", "fa-solid fa-camera", () => saveState(viewedCombat(app)), gm);
    make("scbr.encounter.menu.reset", "Back to the saved state (SCBR)", "fa-solid fa-clock-rotate-left", () => resetCombat(viewedCombat(app)),
      () => gm() && !!service.latestForCombat(viewedCombat(app)?.id));
    make("scbr.encounter.menu.list", "Saved encounter states (SCBR)", "fa-solid fa-box-archive", () => openEncounterManager(), () => game.user?.isGM);
  }

  function countsLine(meta) {
    const c = meta.counts ?? {};
    const parts = [];
    const add = (count, key, fallback) => {
      if (count) parts.push(ctx.format(`scbr.encounter.counts.${key}`, { count }, fallback.replace("{count}", count)));
    };
    add(c.tokens, "tokens", "{count} tokens");
    add(c.actors, "actors", "{count} characters");
    add(c.effects, "effects", "{count} effects");
    add(c.doors, "doors", "{count} doors");
    add(c.lights, "lights", "{count} lights");
    add(c.sounds, "sounds", "{count} sounds");
    return parts.join(", ");
  }

  function buildRows(list, exists = (meta) => !!game.scenes.get(meta.sceneId)) {
    if (!list.length) {
      return `<div class="scbr-empty-state">
        <div class="scbr-empty-icon"><i class="fas fa-clock-rotate-left"></i></div>
        <div class="scbr-empty-title">${ctx.escapeHtml(ctx.localize("scbr.encounter.empty.title", "No saved encounter states yet"))}</div>
        <p class="scbr-empty-copy">${ctx.escapeHtml(ctx.localize("scbr.encounter.empty.copy", "The state is saved when a combat starts, or when you click Save the current state."))}</p>
      </div>`;
    }
    const restoreLabel = ctx.escapeHtml(ctx.localize("scbr.encounter.action.restore", "Reset the scene to this state"));
    const deleteLabel = ctx.escapeHtml(ctx.localize("scbr.encounter.action.delete", "Remove this snapshot"));
    return `<div class="scbr-backup-list scbr-encounter-list">${list.map((meta) => {
      const sceneGone = !exists(meta);
      const kindLabel = service.snapshotTitle(meta.kind);
      const where = [meta.sceneName, meta.combatName].filter(Boolean).join(" - ");
      return `<div class="scbr-backup-row ${sceneGone ? "is-missing" : "is-available"}" data-encounter-id="${ctx.escapeHtml(meta.id)}">
        <div class="scbr-backup-main">
          <div class="scbr-backup-line">
            <span class="scbr-backup-title">${ctx.escapeHtml(meta.name || kindLabel)}</span>
            <span class="scbr-pill is-type">${ctx.escapeHtml(kindLabel)}</span>
            <span class="scbr-backup-doc">${ctx.escapeHtml(where)}${sceneGone ? ` (${ctx.escapeHtml(ctx.localize("scbr.manager.missing", "[deleted]"))})` : ""}</span>
            <span class="scbr-backup-time">${ctx.escapeHtml(ctx.getTimestampString(meta.createdAt))}</span>
          </div>
          <div class="scbr-backup-line"><span class="scbr-backup-doc">${ctx.escapeHtml(countsLine(meta))}</span></div>
        </div>
        <div class="scbr-actions">
          ${sceneGone ? "" : `<button type="button" class="scbr-inline-action is-primary" data-backup-action="encounterRestore" data-backup-id="${ctx.escapeHtml(meta.id)}" aria-label="${restoreLabel}" title="${restoreLabel}"><i class="fas fa-clock-rotate-left"></i></button>`}
          <button type="button" class="scbr-inline-action" data-backup-action="encounterDelete" data-backup-id="${ctx.escapeHtml(meta.id)}" aria-label="${deleteLabel}" title="${deleteLabel}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join("")}</div>`;
  }

  function managerContent(list, exists) {
    return ctx.buildDialogLayout({
      eyebrow: ctx.localize("scbr.dialog.title", "Sephral’s Content Backup & Restore"),
      title: ctx.localize("scbr.encounter.manager.title", "Encounter states"),
      summary: ctx.format("scbr.encounter.manager.summary", { keep: service.keepCount() },
        `The state of a fight at its start, the last ${service.keepCount()} are kept. The reset touches only the scene, the combat and the characters of the snapshot.`),
      count: list.length,
      sectionLabel: ctx.localize("scbr.encounter.manager.section", "Snapshots"),
      sectionHint: ctx.localize("scbr.manager.sortHint", "Newest first, actions on the right."),
      rowsHtml: buildRows(list, exists),
      showCount: false
    });
  }

  function deleteContent() {
    return `<p>${ctx.escapeHtml(ctx.localize("scbr.encounter.delete.body", "Remove this snapshot? It cannot be brought back."))}</p>`;
  }

  /** The list of snapshots in a window of the backup tool. Returns when the GM goes back. */
  async function openEncounterManager() {
    await ctx.ensureTranslations();
    while (true) {
      const content = managerContent(service.listSnapshots());
      const combat = viewedCombat(null);
      const result = await ctx.waitForBackupDialog({
        title: `${ctx.localize("scbr.dialog.title", "Sephral’s Content Backup & Restore")} - ${ctx.localize("scbr.encounter.manager.title", "Encounter states")}`,
        content,
        dialogClass: "scbr-dialog scbr-document-dialog scbr-encounter-dialog",
        width: 1000,
        height: 640,
        onRender: (dialog) => ctx.addSettingsGear(dialog),
        buttons: [
          { action: "save", label: ctx.localize("scbr.encounter.manager.save", "Save the current state"), default: !!combat },
          { action: "back", label: ctx.localize("scbr.encounter.manager.back", "Back") }
        ]
      });
      if (result === "save") {
        await saveState(viewedCombat(null));
        continue;
      }
      if (result?.action === "encounterRestore" && result.backupId) {
        await run(() => service.restoreSnapshot(result.backupId));
        continue;
      }
      if (result?.action === "encounterDelete" && result.backupId) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: ctx.localize("scbr.encounter.delete.title", "Remove snapshot") },
          content: deleteContent(),
          rejectClose: false,
          modal: true
        });
        if (ok && await run(() => service.deleteSnapshot(result.backupId))) ctx.count("encounterDelete");
        continue;
      }
      return;
    }
  }

  return { injectTrackerButtons, addContextEntries, openEncounterManager, saveState, resetCombat, trackerButtons, managerContent, nameContent, deleteContent };
}
