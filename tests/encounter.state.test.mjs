import assert from "node:assert/strict";
import test from "node:test";

import {
  clampKeep, countSnapshot, diffSource, deepEqual, latestForCombat, normalizeIndex, planRestore, snapshotPath,
  summarizePlan, trimIndex, buildMeta, pick, TOKEN_KEYS
} from "../scripts/encounter-state.mjs";

const token = (id, over = {}) => ({ id, data: { _id: id, name: id, x: 100, y: 100, hidden: false, elevation: 0, light: { dim: 0, bright: 0 }, delta: { items: [] }, flags: { other: 1 }, ...over } });
const effect = (id, over = {}) => ({ _id: id, name: id, disabled: false, statuses: [], duration: { rounds: null }, _stats: { modifiedTime: 1 }, ...over });
const actor = (key, over = {}) => ({ key, tokenId: key.startsWith("t:") ? key.slice(2) : null, actorId: "A1", name: key, system: { attributes: { hp: { value: 20, max: 20 } }, spells: { spell1: { value: 2 } } }, items: [], effects: [], ...over });

function savedState(over = {}) {
  return {
    scene: { id: "S1", name: "Cave" },
    combat: { id: "C1", round: 1, turn: 0, combatants: [{ _id: "cb1", tokenId: "T1", initiative: 15, defeated: false, hidden: false }] },
    tokens: [token("T1"), token("T2", { x: 300 })],
    actors: [actor("a:A1", { items: [{ _id: "I1", name: "Potion", system: { quantity: 2 } }], effects: [effect("E1")] }), actor("t:T2")],
    walls: [{ id: "W1", ds: 0 }],
    lights: [{ id: "L1", data: { _id: "L1", hidden: false, x: 5, y: 5 } }],
    sounds: [{ playlistId: "P1", soundId: "N1" }],
    ...over
  };
}

test("diffSource keeps only what differs and replaces arrays whole", () => {
  assert.equal(diffSource({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }), null);
  assert.deepEqual(diffSource({ a: 1, b: { c: 2, d: 3 } }, { a: 2, b: { c: 2, d: 4 } }), { a: 2, b: { d: 4 } });
  assert.deepEqual(diffSource({ list: [1, 2] }, { list: [1, 3] }), { list: [1, 3] });
  // keys that only exist in the current data are left alone
  assert.equal(diffSource({ a: 1, extra: 5 }, { a: 1 }), null);
  // keys the saved state has and the live one lacks are put back
  assert.deepEqual(diffSource({}, { a: { b: 1 } }), { a: { b: 1 } });
  assert.equal(diffSource({ _stats: 1, a: 1 }, { _stats: 2, a: 1 }, { ignore: ["_stats"] }), null);
  assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }), true);
  assert.equal(deepEqual([1], { 0: 1 }), false);
});

test("an unchanged scene plans nothing", () => {
  const saved = savedState();
  const plan = planRestore(saved, structuredClone(saved));
  const summary = summarizePlan(plan);
  assert.equal(summary.empty, true);
  assert.equal(summary.missingActors, 0);
});

test("tokens: moved ones go back, removed ones come back, new ones stay unless asked", () => {
  const saved = savedState();
  const live = structuredClone(saved);
  live.tokens[0].data.x = 900;
  live.tokens[0].data.hidden = true;
  live.tokens[0].data.flags = { other: 2 };
  live.tokens.splice(1, 1);
  live.tokens.push(token("T9"));
  const plan = planRestore(saved, live);
  assert.deepEqual(plan.tokens.update, [{ _id: "T1", x: 100, hidden: false }]);
  assert.equal(plan.tokens.create.length, 1);
  assert.equal(plan.tokens.create[0]._id, "T2");
  assert.equal(plan.tokens.create[0].x, 300);
  assert.deepEqual(plan.tokens.remove, []);
  assert.equal(plan.tokens.added, 1);
  const strict = planRestore(saved, live, { removeAddedTokens: true });
  assert.deepEqual(strict.tokens.remove, ["T9"]);
  // flags and the delta are not part of a token reset
  assert.equal(TOKEN_KEYS.includes("flags"), false);
  assert.equal(TOKEN_KEYS.includes("delta"), false);
  // a deleted unlinked token comes back with its actor data, so that actor is not reported as missing
  const gone = structuredClone(saved);
  gone.actors = gone.actors.filter((a) => a.key !== "t:T2");
  gone.tokens = gone.tokens.filter((t) => t.id !== "T2");
  assert.deepEqual(planRestore(saved, gone).missingActors, []);
  // but with the token still there, an actor that vanished is missing
  const orphan = structuredClone(saved);
  orphan.actors = orphan.actors.filter((a) => a.key !== "t:T2");
  assert.deepEqual(planRestore(saved, orphan).missingActors, ["t:T2"]);
});

test("actors: values, items and effects of linked and unlinked actors", () => {
  const saved = savedState();
  const live = structuredClone(saved);
  live.actors[0].system.attributes.hp.value = 3;
  live.actors[0].system.spells.spell1.value = 0;
  live.actors[0].items[0].system.quantity = 1;
  live.actors[0].items.push({ _id: "I9", name: "Loot", system: {} });
  live.actors[0].effects[0].disabled = true;
  live.actors[0].effects.push(effect("E9", { statuses: ["prone"] }));
  live.actors[1].system.attributes.hp.value = 0;
  live.actors[1].effects.push(effect("E8", { statuses: ["dead"] }));
  live.actors[1].items = [];
  const plan = planRestore(saved, live);
  assert.equal(plan.actors.length, 2);
  const [linked, unlinked] = plan.actors;
  assert.equal(linked.key, "a:A1");
  assert.deepEqual(linked.system, { attributes: { hp: { value: 20 } }, spells: { spell1: { value: 2 } } });
  assert.deepEqual(linked.items.update, [{ _id: "I1", system: { quantity: 2 } }]);
  assert.equal(linked.items.added, 1);
  assert.deepEqual(linked.effects.update, [{ _id: "E1", disabled: false }]);
  assert.deepEqual(linked.effects.remove, ["E9"]);
  assert.equal(unlinked.tokenId, "T2");
  assert.deepEqual(unlinked.system, { attributes: { hp: { value: 20 } } });
  assert.deepEqual(unlinked.effects.remove, ["E8"]);
  const summary = summarizePlan(plan);
  assert.equal(summary.actorsValues, 2);
  assert.equal(summary.effectsRemoved, 2);
  assert.equal(summary.effectsChanged, 1);
  assert.equal(summary.items, 1);
});

test("deleted items and effects are recreated, actors outside the snapshot are never planned", () => {
  const saved = savedState();
  const live = structuredClone(saved);
  live.actors[0].items = [];
  live.actors[0].effects = [];
  live.actors.push(actor("a:OTHER", { system: { attributes: { hp: { value: 1 } } } }));
  const plan = planRestore(saved, live);
  assert.equal(plan.actors.length, 1);
  assert.equal(plan.actors[0].items.create.length, 1);
  assert.equal(plan.actors[0].effects.create.length, 1);
  assert.equal(plan.actors.some((a) => a.key === "a:OTHER"), false);
  // an actor that vanished is reported, not planned
  live.actors = live.actors.filter((a) => a.key !== "a:A1");
  const missing = planRestore(saved, live);
  assert.deepEqual(missing.missingActors, ["a:A1"]);
});

test("doors, lights, combat and music", () => {
  const saved = savedState();
  const live = structuredClone(saved);
  live.walls[0].ds = 1;
  live.lights[0].data.hidden = true;
  live.lights.push({ id: "L9", data: { _id: "L9" } });
  live.combat.round = 4;
  live.combat.turn = 2;
  live.combat.combatants[0].initiative = 3;
  live.combat.combatants[0].defeated = true;
  live.combat.combatants.push({ _id: "cb9", initiative: 1 });
  live.sounds = [{ playlistId: "P1", soundId: "N2" }];
  const plan = planRestore(saved, live);
  assert.deepEqual(plan.walls, [{ _id: "W1", ds: 0 }]);
  assert.deepEqual(plan.lights.update, [{ _id: "L1", hidden: false }]);
  assert.equal(plan.lights.added, 1);
  assert.deepEqual(plan.combat.changes, { round: 1, turn: 0 });
  assert.deepEqual(plan.combat.update, [{ _id: "cb1", initiative: 15, defeated: false }]);
  assert.equal(plan.combat.added, 1);
  assert.deepEqual(plan.sounds.play, [{ playlistId: "P1", soundId: "N1" }]);
  assert.deepEqual(plan.sounds.stop, [{ playlistId: "P1", soundId: "N2" }]);
  const off = planRestore(saved, live, { includeMusic: false });
  assert.deepEqual(off.sounds, { play: [], stop: [] });
  // another combat is never touched
  const other = structuredClone(live);
  other.combat.id = "C2";
  assert.equal(planRestore(saved, other).combat, null);
});

test("index helpers: keep the newest, order, counts, paths", () => {
  const meta = (id, createdAt, over = {}) => ({ id, createdAt, kind: "start", combatId: "C1", ...over });
  const list = [meta("a", "2026-01-01"), meta("b", "2026-01-03"), meta("c", "2026-01-02", { kind: "safety" }), meta("d", "2026-01-04", { combatId: "C2" })];
  assert.deepEqual(normalizeIndex({ snapshots: list }).map((m) => m.id), ["d", "b", "c", "a"]);
  const { kept, dropped } = trimIndex(list, 2);
  assert.deepEqual(kept.map((m) => m.id), ["d", "b"]);
  assert.deepEqual(dropped.map((m) => m.id), ["c", "a"]);
  assert.equal(latestForCombat(list, "C1").id, "b");
  assert.equal(latestForCombat(list, "nope"), null);
  assert.equal(clampKeep(0), 1);
  assert.equal(clampKeep(99), 20);
  assert.equal(clampKeep("x"), 5);
  assert.equal(snapshotPath("ab/../c"), "encounters/abc.json");
  assert.deepEqual(normalizeIndex(null), []);
  assert.deepEqual(normalizeIndex({ snapshots: [null, {}, { id: "x", kind: "weird" }] }).map((m) => m.kind), ["manual"]);
  assert.deepEqual(pick({ a: 1, b: 2 }, ["b", "z"]), { b: 2 });
  const saved = savedState();
  assert.deepEqual(countSnapshot(saved), { tokens: 2, actors: 2, effects: 1, doors: 1, lights: 1, sounds: 1 });
  const built = buildMeta({ id: "Z", kind: "start", name: " Start ", saved, combatName: "Goblins" });
  assert.equal(built.name, "Start");
  assert.equal(built.path, "encounters/Z.json");
  assert.equal(built.round, 1);
  assert.equal(built.sceneName, "Cave");
});
