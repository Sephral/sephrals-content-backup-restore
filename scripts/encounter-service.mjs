// Encounter snapshots, the Foundry side: reads the state of a fight (hit points and resources, effects, tokens, doors,
// lights, playing music), stores it with the storage and lock logic of scbr.js and applies a reset. The comparison
// itself is pure and lives in encounter-state.mjs. scbr.js hands in its helpers through `createEncounterService`.
import {
  SNAPSHOT_VERSION, SNAPSHOT_FOLDER, clampKeep, clone, normalizeIndex, trimIndex, buildMeta, planRestore, summarizePlan,
  latestForCombat
} from "./encounter-state.mjs";

// Fresh options for every call: core adds keys to the object it gets (a frozen one throws).
const ro = (extra = {}) => ({ scbrEncounterRestore: true, ...extra });
const MAX_PASSES = 2;

function stripStats(data) {
  if (data && typeof data === "object") delete data._stats;
  return data;
}

function sceneOfCombat(combat) {
  if (combat?.scene) return combat.scene;
  for (const combatant of combat?.combatants ?? []) {
    const scene = combatant.token?.parent;
    if (scene) return scene;
  }
  return canvas?.scene ?? null;
}

function actorKey(token, actor) {
  return token && !token.actorLink ? `t:${token.id}` : `a:${actor.id}`;
}

function resolveActor(scene, entry) {
  if (entry.tokenId) return scene?.tokens?.get(entry.tokenId)?.actor ?? null;
  return game.actors.get(entry.actorId) ?? null;
}

function readActor(scene, entry) {
  const actor = resolveActor(scene, entry);
  if (!actor) return null;
  const source = actor.toObject();
  return {
    key: entry.key, tokenId: entry.tokenId ?? null, actorId: actor.id, name: actor.name,
    system: clone(source.system ?? {}),
    items: source.items.map((item) => stripStats(clone(item))),
    effects: source.effects.map((effect) => stripStats(clone(effect)))
  };
}

/**
 * Creates embedded documents with their old ids, skipping the ones that exist again (a system may have re-created its own
 * effect already). One that still fails does not stop the reset, the second pass and the notice report what is left.
 */
async function createTolerant(parent, type, list, collection) {
  const missing = list.filter((data) => !collection.has(data._id));
  if (!missing.length) return;
  try {
    await parent.createEmbeddedDocuments(type, missing, ro({ keepId: true }));
  } catch (error) {
    console.warn(`sephrals-content-backup-restore | Could not recreate ${type} documents in one call, trying one by one`, error);
    for (const data of missing) {
      if (collection.has(data._id)) continue;
      try {
        await parent.createEmbeddedDocuments(type, [data], ro({ keepId: true }));
      } catch (single) {
        console.warn(`sephrals-content-backup-restore | Could not recreate ${type} ${data._id}`, single);
      }
    }
  }
}

export function createEncounterService(ctx) {
  const { MODULE_ID, INDEX_SETTING, KEEP_SETTING, MUSIC_SETTING } = ctx;

  function setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key);
    } catch (_error) {
      return fallback;
    }
  }

  const musicEnabled = () => setting(MUSIC_SETTING, true) !== false;
  const keepCount = () => clampKeep(setting(KEEP_SETTING, 5));
  const readIndex = () => normalizeIndex(setting(INDEX_SETTING, null));

  /**
   * The state of a scene and its fight as plain data. `refs` adds actors that are not (or no longer) combatants, so a
   * reset can compare the actors of the saved state with the live ones. Synchronous on purpose: the combat start hook
   * fires before the combat updates, so what is read here is the state before the first round.
   */
  function captureState({ combat = null, scene = null, round = null, turn = null, refs = [], music = musicEnabled() } = {}) {
    scene ??= sceneOfCombat(combat);
    if (!scene) return null;

    const tokens = scene.tokens.map((token) => ({ id: token.id, data: stripStats(clone(token.toObject())) }));

    const actors = [];
    const seen = new Set();
    const add = (entry) => {
      if (seen.has(entry.key)) return;
      const read = readActor(scene, entry);
      if (!read) return;
      seen.add(entry.key);
      actors.push(read);
    };
    for (const combatant of combat?.combatants ?? []) {
      const token = combatant.token;
      const actor = combatant.actor;
      if (!actor || (token && token.parent?.id !== scene.id)) continue;
      add({ key: actorKey(token, actor), tokenId: token && !token.actorLink ? token.id : null, actorId: actor.id });
    }
    for (const ref of refs) add(ref);

    const walls = scene.walls.filter((wall) => wall.door > 0).map((wall) => ({ id: wall.id, ds: wall.ds }));
    const lights = scene.lights.map((light) => ({ id: light.id, data: stripStats(clone(light.toObject())) }));
    const sounds = music
      ? game.playlists.contents.flatMap((playlist) => playlist.sounds.filter((sound) => sound.playing)
        .map((sound) => ({ playlistId: playlist.id, soundId: sound.id })))
      : [];

    return {
      scene: { id: scene.id, name: scene.name },
      combat: combat ? {
        id: combat.id, round: round ?? combat.round, turn: turn ?? combat.turn,
        combatants: combat.combatants.map((combatant) => stripStats(clone(combatant.toObject())))
      } : null,
      tokens, actors, walls, lights, sounds, music
    };
  }

  /** The live state in the shape of a saved one, for the actors the saved state names. */
  function readLiveState(saved) {
    const scene = game.scenes.get(saved.scene.id);
    if (!scene) return null;
    const combat = saved.combat ? game.combats.get(saved.combat.id) ?? null : null;
    const refs = saved.actors.map((actor) => ({ key: actor.key, tokenId: actor.tokenId, actorId: actor.actorId }));
    return captureState({ combat, scene, refs, music: saved.music !== false && musicEnabled() });
  }

  async function writeFile(file, path, root) {
    const response = await ctx.upload(file, path, root);
    if (!response?.path) throw new Error(`Failed to write the encounter file '${path}'.`);
    return response;
  }

  async function saveSnapshot({ saved, kind, name, combatName = "" }) {
    const id = foundry.utils.randomID();
    const meta = { ...buildMeta({ id, kind, name, saved, combatName }), ...ctx.getWorldEnvironment() };
    const file = { version: SNAPSHOT_VERSION, ...meta, data: saved };
    const stored = await ctx.withLock(async () => {
      await ctx.ensureDirectory(SNAPSHOT_FOLDER);
      const response = await writeFile(file, meta.path);
      if (ctx.isAbsoluteUrl(response.path)) meta.url = response.path;
      const { kept, dropped } = trimIndex([meta, ...readIndex()], keepCount());
      await game.settings.set(MODULE_ID, INDEX_SETTING, { version: SNAPSHOT_VERSION, snapshots: kept });
      // Foundry has no client-side delete: the dropped files are emptied, so no scene data stays behind.
      for (const old of dropped) {
        try {
          await writeFile({ version: SNAPSHOT_VERSION, id: old.id, removed: true }, old.path);
        } catch (error) {
          console.warn(`${MODULE_ID} | Could not empty the old snapshot ${old.id}`, error);
        }
      }
      return meta;
    });
    // The reset button of the tracker was drawn before this state existed
    try { ui.combat?.render(); } catch { /* the tracker is optional */ }
    return stored;
  }

  async function loadSnapshot(meta) {
    for await (const { data } of ctx.iterate(meta.path, { roots: [ctx.worldRoot()], urls: [meta.url] })) {
      if (data?.data && !data.removed) return data;
    }
    throw new Error(ctx.format("scbr.encounter.error.file", { name: meta.name }, `The snapshot '${meta.name}' could not be read.`));
  }

  async function deleteSnapshot(id) {
    return ctx.withLock(async () => {
      const index = readIndex();
      const meta = index.find((entry) => entry.id === id);
      if (!meta) return false;
      await game.settings.set(MODULE_ID, INDEX_SETTING, { version: SNAPSHOT_VERSION, snapshots: index.filter((entry) => entry.id !== id) });
      try {
        await writeFile({ version: SNAPSHOT_VERSION, id, removed: true }, meta.path);
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not empty the snapshot ${id}`, error);
      }
      return true;
    });
  }

  function snapshotTitle(kind) {
    const key = { start: "start", manual: "manual", safety: "safety" }[kind] ?? "manual";
    const fallback = { start: "Start of combat", manual: "Saved by hand", safety: "Before reset" }[key];
    return ctx.localize(`scbr.encounter.kind.${key}`, fallback);
  }

  /** Reads the state now and stores it. Returns the index entry. */
  async function saveCurrent(combat, { kind = "manual", round = null, turn = null, name = null } = {}) {
    const saved = captureState({ combat, round, turn });
    if (!saved) throw new Error(ctx.localize("scbr.encounter.error.noScene", "There is no scene to save."));
    const combatName = combat?.name ?? "";
    return saveSnapshot({ saved, kind, name: name ?? snapshotTitle(kind), combatName });
  }

  /** Hook handler of the combat start (the client that clicked). Fire and forget, errors are logged. */
  async function onCombatStart(combat, updateData) {
    if (!game.user?.isGM || setting(ctx.AUTO_SETTING, true) === false) return null;
    // Read now, synchronously: the hook runs before the combat updates, so this is the state before the first round.
    const saved = captureState({ combat, round: updateData?.round ?? 1, turn: updateData?.turn ?? 0 });
    if (!saved) return null;
    const meta = await saveSnapshot({ saved, kind: "start", name: snapshotTitle("start"), combatName: combat?.name ?? "" });
    ctx.count("encounterAutoSave");
    ui.notifications.info(ctx.format("scbr.encounter.notice.autoSaved", { scene: saved.scene.name }, `Saved the state at the start of the fight in ${saved.scene.name}.`));
    return meta;
  }

  function planFor(saved, options = {}) {
    const live = readLiveState(saved);
    if (!live) return null;
    const plan = planRestore(saved, live, { includeMusic: saved.music !== false && musicEnabled(), ...options });
    return plan;
  }

  async function applyPlan(plan, saved, { first = true } = {}) {
    const scene = game.scenes.get(plan.sceneId);
    // isUndo: the move is a correction, not a step, so it is neither animated nor recorded in the movement history (v13 and v14)
    const move = { animate: false, isUndo: true };

    if (plan.tokens.create.length) await scene.createEmbeddedDocuments("Token", plan.tokens.create, ro({ keepId: true }));
    if (plan.tokens.update.length) await scene.updateEmbeddedDocuments("Token", plan.tokens.update, ro(move));
    if (plan.tokens.remove.length) await scene.deleteEmbeddedDocuments("Token", plan.tokens.remove, ro());

    for (const entry of plan.actors) {
      const actor = resolveActor(scene, entry);
      if (!actor) continue;
      // Effects first: a system like dnd5e adds and removes its own effects (Bloodied) when the hit points change, and
      // those carry fixed ids. With the effects already in place the hit point update has nothing left to do.
      const removable = entry.effects.remove.filter((id) => actor.effects.has(id));
      if (removable.length) await actor.deleteEmbeddedDocuments("ActiveEffect", removable, ro());
      if (entry.effects.update.length) await actor.updateEmbeddedDocuments("ActiveEffect", entry.effects.update.filter((e) => actor.effects.has(e._id)), ro());
      await createTolerant(actor, "ActiveEffect", entry.effects.create, actor.effects);
      if (entry.items.update.length) await actor.updateEmbeddedDocuments("Item", entry.items.update, ro());
      await createTolerant(actor, "Item", entry.items.create, actor.items);
      if (entry.system) await actor.update({ system: entry.system }, ro());
    }

    if (plan.walls.length) await scene.updateEmbeddedDocuments("Wall", plan.walls, ro());
    if (plan.lights.update.length) await scene.updateEmbeddedDocuments("AmbientLight", plan.lights.update, ro());
    if (plan.lights.create.length) await scene.createEmbeddedDocuments("AmbientLight", plan.lights.create, ro({ keepId: true }));

    const combat = plan.combat ? game.combats.get(plan.combat.id) : null;
    if (combat) {
      const quiet = (extra = {}) => ro({ turnEvents: false, ...extra });
      if (plan.combat.create.length) await combat.createEmbeddedDocuments("Combatant", plan.combat.create, quiet({ keepId: true }));
      if (plan.combat.update.length) await combat.updateEmbeddedDocuments("Combatant", plan.combat.update, quiet());
      if (Object.keys(plan.combat.changes).length) await combat.update(plan.combat.changes, quiet());
    }

    // Music only in the first pass: a sound reports `playing` a moment after it started.
    if (first) {
      for (const { playlistId, soundId } of plan.sounds.stop) {
        const playlist = game.playlists.get(playlistId);
        const sound = playlist?.sounds.get(soundId);
        if (sound) await playlist.stopSound(sound);
      }
      for (const { playlistId, soundId } of plan.sounds.play) {
        const playlist = game.playlists.get(playlistId);
        const sound = playlist?.sounds.get(soundId);
        if (sound) await playlist.playSound(sound);
      }
    }
  }

  function describeSummary(summary) {
    const lines = [];
    const add = (count, key, fallback) => {
      if (count) lines.push(ctx.format(`scbr.encounter.summary.${key}`, { count }, fallback.replace("{count}", count)));
    };
    add(summary.tokensMoved, "tokensMoved", "{count} tokens go back to their old place or look");
    add(summary.tokensRestored, "tokensRestored", "{count} tokens that were removed come back");
    add(summary.tokensRemoved, "tokensRemoved", "{count} tokens added since are removed");
    add(summary.actorsValues, "actorsValues", "{count} characters get their hit points and resources back");
    add(summary.items, "items", "{count} items get their uses and quantities back");
    add(summary.effectsRemoved, "effectsRemoved", "{count} effects and conditions added since are removed");
    add(summary.effectsRestored, "effectsRestored", "{count} effects and conditions come back");
    add(summary.effectsChanged, "effectsChanged", "{count} effects get their old state back");
    add(summary.doors, "doors", "{count} doors");
    add(summary.lights, "lights", "{count} lights");
    add(summary.combatants, "combatants", "{count} entries of the combat tracker");
    add(summary.combat, "combat", "The combat goes back to the first round");
    add(summary.soundsStarted + summary.soundsStopped, "music", "{count} sounds change");
    return lines;
  }

  async function confirmRestore(meta, summary, { safety }) {
    const items = describeSummary(summary).map((line) => `<li>${ctx.escapeHtml(line)}</li>`).join("");
    const kept = [];
    if (summary.tokensAdded) kept.push(ctx.format("scbr.encounter.summary.tokensKept", { count: summary.tokensAdded }, `${summary.tokensAdded} tokens added since stay on the scene.`));
    if (summary.missingActors) kept.push(ctx.format("scbr.encounter.summary.missing", { count: summary.missingActors }, `${summary.missingActors} characters no longer exist and are skipped.`));
    const warning = ctx.getCompatibilityWarning(meta);
    return foundry.applications.api.DialogV2.confirm({
      window: { title: ctx.localize("scbr.encounter.confirm.title", "Reset the encounter") },
      content: `<p>${ctx.escapeHtml(ctx.format("scbr.encounter.confirm.body", { name: meta.name, scene: meta.sceneName, time: ctx.getTimestampString(meta.createdAt) },
        `Reset the scene '${meta.sceneName}' to the state '${meta.name}' (${ctx.getTimestampString(meta.createdAt)})?`))}</p>
        <ul class="scbr-encounter-summary">${items}</ul>
        ${kept.length ? `<p><small>${ctx.escapeHtml(kept.join(" "))}</small></p>` : ""}
        ${warning ? `<p class="scbr-compat-warning"><i class="fas fa-triangle-exclamation"></i> ${ctx.escapeHtml(warning)}</p>` : ""}
        <p>${ctx.escapeHtml(safety
    ? ctx.localize("scbr.encounter.confirm.safety", "The current state is saved first, so you can undo the reset.")
    : ctx.localize("scbr.encounter.confirm.noSafety", "The automatic copy before a reset is turned off in the module settings."))}</p>
        <p><small>${ctx.escapeHtml(ctx.localize("scbr.encounter.confirm.scope", "Only the scene, the combat and the characters of this snapshot are touched."))}</small></p>`,
      yes: { label: ctx.localize("scbr.encounter.confirm.yes", "Reset") },
      no: { label: ctx.localize("scbr.action.cancel", "Cancel") },
      rejectClose: false,
      modal: true
    });
  }

  /**
   * Resets the scene to a snapshot. Returns `{ done, summary, remaining }`. `confirm: false` skips the dialog (API).
   * The current state is saved as a "before reset" snapshot first (setting "Backup before restore"), and if that copy
   * cannot be saved the reset does not run.
   */
  async function restoreSnapshot(id, { confirm = true, removeAddedTokens = false } = {}) {
    const meta = readIndex().find((entry) => entry.id === id);
    if (!meta) throw new Error(ctx.format("scbr.encounter.error.notFound", { id }, `No snapshot with the id '${id}' was found.`));
    const file = await loadSnapshot(meta);
    const saved = file.data;
    if (!game.scenes.get(saved.scene.id)) {
      throw new Error(ctx.format("scbr.encounter.error.sceneGone", { scene: saved.scene.name }, `The scene '${saved.scene.name}' no longer exists.`));
    }
    const plan = planFor(saved, { removeAddedTokens });
    const summary = summarizePlan(plan);
    if (summary.empty) {
      ui.notifications.info(ctx.localize("scbr.encounter.notice.nothing", "Nothing to reset, the scene is already in that state."));
      return { done: false, summary, remaining: 0 };
    }
    const safety = ctx.isSafetyBackupEnabled();
    if (confirm && !await confirmRestore(meta, summary, { safety })) return { done: false, summary, remaining: 0 };

    if (safety) {
      const live = readLiveState(saved);
      await saveSnapshot({ saved: live, kind: "safety", name: snapshotTitle("safety"), combatName: meta.combatName });
      ctx.count("encounterSafety");
    }

    let remaining = 0;
    let current = plan;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      await applyPlan(current, saved, { first: pass === 1 });
      // Core writes to unlinked tokens can lose an update that follows another one, so look again and finish the rest.
      const again = planFor(saved, { removeAddedTokens, includeMusic: false });
      const left = summarizePlan(again);
      remaining = left.empty ? 0 : left.tokensMoved + left.tokensRestored + left.actors + left.doors + left.lights + left.combat;
      if (!remaining) break;
      current = again;
    }
    ctx.count("encounterRestore");
    if (remaining) {
      ui.notifications.warn(ctx.format("scbr.encounter.notice.partial", { count: remaining }, `The reset left ${remaining} differences. Run it once more.`));
    } else {
      ui.notifications.info(ctx.format("scbr.encounter.notice.restored", { scene: meta.sceneName }, `The scene '${meta.sceneName}' is back in the saved state.`));
    }
    if (canvas?.scene?.id === saved.scene.id) canvas.perception?.update?.({ refreshVision: true, refreshLighting: true });
    return { done: true, summary, remaining };
  }

  function describeState() {
    const index = readIndex();
    return {
      snapshots: index.length,
      keep: keepCount(),
      auto: setting(ctx.AUTO_SETTING, true) !== false,
      music: musicEnabled(),
      latest: index[0]?.createdAt ?? null,
      byKind: index.reduce((out, meta) => ({ ...out, [meta.kind]: (out[meta.kind] ?? 0) + 1 }), {})
    };
  }

  return {
    captureState, readLiveState, saveSnapshot, saveCurrent, loadSnapshot, deleteSnapshot, restoreSnapshot, onCombatStart,
    listSnapshots: readIndex, latestForCombat: (combatId) => latestForCombat(readIndex(), combatId),
    planFor, applyPlan, describeSummary, describeState, snapshotTitle, keepCount
  };
}
