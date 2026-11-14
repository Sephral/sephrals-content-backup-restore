// Encounter snapshots, the pure part: what a snapshot holds, how two states are compared and what a reset has to
// change. Nothing in here touches Foundry, so node tests run it directly. The Foundry side (reading documents,
// storing, applying) lives in encounter-service.mjs.

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_FOLDER = "encounters";
export const DEFAULT_KEEP = 5;
export const MIN_KEEP = 1;
export const MAX_KEEP = 20;
export const KINDS = Object.freeze(["start", "manual", "safety"]);

// What of a token a reset puts back. Flags and the actor delta are left alone on purpose (the delta is restored
// through the actor), so other modules' marks on a token survive a reset.
export const TOKEN_KEYS = Object.freeze(["x", "y", "elevation", "level", "rotation", "hidden", "width", "height",
  "name", "disposition", "light", "sight"]);
export const ITEM_KEYS = Object.freeze(["name", "system"]);
// Keys a comparison of embedded documents never looks at: bookkeeping, not state.
export const IGNORED_KEYS = Object.freeze(["_stats", "sort", "ownership"]);
export const COMBATANT_KEYS = Object.freeze(["initiative", "defeated", "hidden"]);

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }
  return false;
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function pick(object, keys) {
  const out = {};
  if (!object) return out;
  for (const key of keys) if (key in object) out[key] = object[key];
  return out;
}

/**
 * What has to change in `current` to become `saved`: the keys of `saved` whose values differ, nested for plain
 * objects, replaced as a whole for arrays and values. Keys that only exist in `current` are not touched. Returns null
 * when nothing differs.
 */
export function diffSource(current, saved, { ignore = [] } = {}) {
  const out = {};
  for (const key of Object.keys(saved ?? {})) {
    if (ignore.includes(key)) continue;
    const want = saved[key];
    const have = current?.[key];
    if (isPlainObject(want) && isPlainObject(have)) {
      const nested = diffSource(have, want);
      if (nested) out[key] = nested;
    } else if (!deepEqual(have, want)) out[key] = clone(want);
  }
  return Object.keys(out).length ? out : null;
}

function byId(list, idKey = "_id") {
  return new Map((list ?? []).map((entry) => [entry?.[idKey], entry]));
}

function planEmbedded(liveList, savedList, { keys = null, deleteAdded = false } = {}) {
  const live = byId(liveList);
  const out = { updates: [], creates: [], deletes: [], added: 0 };
  for (const saved of savedList ?? []) {
    const now = live.get(saved._id);
    if (!now) {
      out.creates.push(clone(saved));
      continue;
    }
    const changes = keys
      ? diffSource(pick(now, keys), pick(saved, keys), { ignore: IGNORED_KEYS })
      : diffSource(now, saved, { ignore: IGNORED_KEYS });
    if (changes) out.updates.push({ _id: saved._id, ...changes });
  }
  const savedIds = new Set((savedList ?? []).map((entry) => entry._id));
  const added = (liveList ?? []).filter((entry) => !savedIds.has(entry._id));
  if (deleteAdded) out.deletes = added.map((entry) => entry._id);
  else out.added = added.length;
  return out;
}

/**
 * The changes that bring `live` back to `saved`. Both are plain states as built by the service. Nothing outside the
 * saved state is touched: tokens, actors, effects and items that appeared later stay (tokens only go when
 * `removeAddedTokens` is set, effects always go because a condition added during the fight is what a reset undoes).
 */
export function planRestore(saved, live, { removeAddedTokens = false, includeMusic = true } = {}) {
  const plan = {
    sceneId: saved?.scene?.id ?? null,
    tokens: { create: [], update: [], remove: [], added: 0 },
    actors: [],
    missingActors: [],
    walls: [],
    lights: { update: [], create: [], added: 0 },
    combat: null,
    sounds: { play: [], stop: [] }
  };

  const tokens = planEmbedded((live?.tokens ?? []).map((t) => ({ _id: t.id, ...t.data })),
    (saved?.tokens ?? []).map((t) => ({ _id: t.id, ...t.data })), { keys: TOKEN_KEYS });
  plan.tokens.create = tokens.creates.map(({ _id, ...data }) => ({ _id, ...data }));
  plan.tokens.update = tokens.updates;
  const savedTokenIds = new Set((saved?.tokens ?? []).map((t) => t.id));
  const addedTokens = (live?.tokens ?? []).filter((t) => !savedTokenIds.has(t.id));
  if (removeAddedTokens) plan.tokens.remove = addedTokens.map((t) => t.id);
  else plan.tokens.added = addedTokens.length;

  const liveActors = new Map((live?.actors ?? []).map((a) => [a.key, a]));
  for (const actor of saved?.actors ?? []) {
    const now = liveActors.get(actor.key);
    if (!now) {
      // A deleted unlinked token comes back with its actor data, so that is not a missing actor.
      if (actor.tokenId && plan.tokens.create.some((token) => token._id === actor.tokenId)) continue;
      plan.missingActors.push(actor.name ?? actor.key);
      continue;
    }
    const system = diffSource(now.system ?? {}, actor.system ?? {});
    const items = planEmbedded(now.items, actor.items, { keys: ITEM_KEYS });
    const effects = planEmbedded(now.effects, actor.effects, { deleteAdded: true });
    if (!system && !items.updates.length && !items.creates.length && !effects.updates.length
      && !effects.creates.length && !effects.deletes.length) continue;
    plan.actors.push({
      key: actor.key, tokenId: actor.tokenId ?? null, actorId: actor.actorId ?? null, name: actor.name ?? "",
      system,
      items: { update: items.updates, create: items.creates, added: items.added },
      effects: { update: effects.updates, create: effects.creates, remove: effects.deletes }
    });
  }

  const liveWalls = new Map((live?.walls ?? []).map((w) => [w.id, w]));
  for (const wall of saved?.walls ?? []) {
    const now = liveWalls.get(wall.id);
    if (now && now.ds !== wall.ds) plan.walls.push({ _id: wall.id, ds: wall.ds });
  }

  const lights = planEmbedded((live?.lights ?? []).map((l) => ({ _id: l.id, ...l.data })),
    (saved?.lights ?? []).map((l) => ({ _id: l.id, ...l.data })));
  plan.lights = { update: lights.updates, create: lights.creates, added: lights.added };

  if (saved?.combat && live?.combat && saved.combat.id === live.combat.id) {
    const changes = {};
    for (const key of ["round", "turn"]) if (!deepEqual(saved.combat[key], live.combat[key])) changes[key] = saved.combat[key];
    const combatants = planEmbedded(live.combat.combatants, saved.combat.combatants, { keys: COMBATANT_KEYS });
    if (Object.keys(changes).length || combatants.updates.length || combatants.creates.length) {
      plan.combat = { id: saved.combat.id, changes, update: combatants.updates, create: combatants.creates, added: combatants.added };
    }
  }

  if (includeMusic) {
    const liveSounds = new Set((live?.sounds ?? []).map((s) => `${s.playlistId}:${s.soundId}`));
    const savedSounds = new Set((saved?.sounds ?? []).map((s) => `${s.playlistId}:${s.soundId}`));
    plan.sounds.play = (saved?.sounds ?? []).filter((s) => !liveSounds.has(`${s.playlistId}:${s.soundId}`));
    plan.sounds.stop = (live?.sounds ?? []).filter((s) => !savedSounds.has(`${s.playlistId}:${s.soundId}`));
  }
  return plan;
}

/** Counts of what a plan changes, for the confirmation and the notice. */
export function summarizePlan(plan) {
  const sum = (key) => plan.actors.reduce((total, a) => total + a.effects[key].length, 0);
  const summary = {
    tokensMoved: plan.tokens.update.length,
    tokensRestored: plan.tokens.create.length,
    tokensRemoved: plan.tokens.remove.length,
    tokensAdded: plan.tokens.added,
    actors: plan.actors.length,
    actorsValues: plan.actors.filter((a) => a.system).length,
    items: plan.actors.reduce((total, a) => total + a.items.update.length + a.items.create.length, 0),
    effectsRemoved: sum("remove"),
    effectsRestored: sum("create"),
    effectsChanged: sum("update"),
    doors: plan.walls.length,
    lights: plan.lights.update.length + plan.lights.create.length,
    combat: plan.combat ? 1 : 0,
    combatants: plan.combat ? plan.combat.update.length + plan.combat.create.length : 0,
    soundsStarted: plan.sounds.play.length,
    soundsStopped: plan.sounds.stop.length,
    missingActors: plan.missingActors.length
  };
  const changing = ["tokensMoved", "tokensRestored", "tokensRemoved", "actors", "doors", "lights", "combat", "soundsStarted", "soundsStopped"];
  summary.empty = changing.every((key) => !summary[key]);
  return summary;
}

/** Counts of what a saved state holds, kept in the index so the list needs no file reads. */
export function countSnapshot(saved) {
  return {
    tokens: saved?.tokens?.length ?? 0,
    actors: saved?.actors?.length ?? 0,
    effects: (saved?.actors ?? []).reduce((total, a) => total + (a.effects?.length ?? 0), 0),
    doors: saved?.walls?.length ?? 0,
    lights: saved?.lights?.length ?? 0,
    sounds: saved?.sounds?.length ?? 0
  };
}

export function clampKeep(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_KEEP;
  return Math.min(MAX_KEEP, Math.max(MIN_KEEP, number));
}

export function snapshotPath(id) {
  return `${SNAPSHOT_FOLDER}/${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}.json`;
}

/** The index entry of a snapshot: no document data, only what the list shows. */
export function buildMeta({ id, kind, name, createdAt, saved, combatName = "" }) {
  return {
    id,
    kind: KINDS.includes(kind) ? kind : "manual",
    name: String(name ?? "").trim(),
    createdAt: createdAt ?? new Date().toISOString(),
    combatId: saved?.combat?.id ?? null,
    combatName: String(combatName ?? ""),
    sceneId: saved?.scene?.id ?? null,
    sceneName: saved?.scene?.name ?? "",
    round: saved?.combat?.round ?? null,
    counts: countSnapshot(saved),
    path: snapshotPath(id)
  };
}

export function normalizeIndex(raw) {
  const list = Array.isArray(raw?.snapshots) ? raw.snapshots : [];
  return list.filter((meta) => meta && typeof meta.id === "string" && meta.id)
    .map((meta) => ({ ...meta, kind: KINDS.includes(meta.kind) ? meta.kind : "manual", counts: meta.counts ?? {} }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** The newest `keep` entries stay, the rest is dropped from the index (their files are emptied by the service). */
export function trimIndex(list, keep) {
  const sorted = normalizeIndex({ snapshots: list });
  const limit = clampKeep(keep);
  return { kept: sorted.slice(0, limit), dropped: sorted.slice(limit) };
}

/** The newest snapshot of a combat (any kind except the safety copy), for the tracker button. */
export function latestForCombat(list, combatId) {
  return normalizeIndex({ snapshots: list }).find((meta) => meta.combatId === combatId && meta.kind !== "safety") ?? null;
}

export const __test__ = { byId, planEmbedded };
