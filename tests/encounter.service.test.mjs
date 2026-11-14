import assert from "node:assert/strict";
import test from "node:test";

import { createResponse, createTestEnvironment } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import("../scripts/scbr.js");
const { encounterService } = __test__;

// A small fake world: documents keep their data and apply updates, so a reset can be checked end to end.
const clone = (value) => structuredClone(value);
function merge(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object") merge(target[key], value);
    else target[key] = clone(value);
  }
}

class Coll extends Map {
  [Symbol.iterator]() { return this.values(); }
  map(fn) { return [...this.values()].map(fn); }
  filter(fn) { return [...this.values()].filter(fn); }
  get contents() { return [...this.values()]; }
}

class Embedded {
  constructor(data) {
    this.data = clone(data);
    this.id = data._id;
    // the fields read like properties of a Foundry document (wall.door, wall.ds)
    for (const key of Object.keys(data)) if (!(key in this)) Object.defineProperty(this, key, { get: () => this.data[key], configurable: true });
  }
  get _id() { return this.id; }
  toObject() { return clone(this.data); }
}

class Parent {
  constructor() { this.calls = []; this.collections = {}; }
  collectionFor(type) { return this.collections[type]; }
  async updateEmbeddedDocuments(type, updates, options) {
    this.calls.push(["update", type, clone(updates), options]);
    for (const update of updates) {
      const doc = this.collectionFor(type).get(update._id);
      const { _id, ...changes } = update;
      merge(doc.data, changes);
    }
  }
  async createEmbeddedDocuments(type, creates, options) {
    this.calls.push(["create", type, clone(creates), options]);
    for (const data of creates) this.collectionFor(type).set(data._id, this.make(type, data));
  }
  async deleteEmbeddedDocuments(type, ids, options) {
    this.calls.push(["delete", type, ids, options]);
    for (const id of ids) this.collectionFor(type).delete(id);
  }
}

class FakeActor extends Parent {
  constructor(data) {
    super();
    this.id = data._id;
    this.name = data.name;
    this.system = clone(data.system);
    this.items = new Coll();
    this.effects = new Coll();
    this.collections = { Item: this.items, ActiveEffect: this.effects };
    for (const item of data.items ?? []) this.items.set(item._id, new Embedded(item));
    for (const effect of data.effects ?? []) this.effects.set(effect._id, new Embedded(effect));
  }
  make(type, data) { return new Embedded(data); }
  toObject() {
    return { _id: this.id, name: this.name, system: clone(this.system), items: this.items.map((i) => i.toObject()), effects: this.effects.map((e) => e.toObject()) };
  }
  async update(data, options) {
    this.calls.push(["actor", clone(data), options]);
    if (data.system) merge(this.system, data.system);
  }
}

class FakeToken extends Embedded {
  constructor(data, actor) {
    super(data);
    this.actor = actor;
  }
  get parent() { return this.scene; }
}

class FakeScene extends Parent {
  constructor() {
    super();
    this.id = "SCENE000000000A1";
    this.name = "Cave";
    this.tokens = new Coll();
    this.walls = new Coll();
    this.lights = new Coll();
    this.collections = { Token: this.tokens, Wall: this.walls, AmbientLight: this.lights };
  }
  make(type, data) {
    if (type !== "Token") return new Embedded(data);
    const token = new FakeToken(data, data.actorLink ? game.actors.get(data.actorId) : new FakeActor(data.delta));
    token.scene = this;
    return token;
  }
}

function buildWorld() {
  const hero = new FakeActor({ _id: "HERO000000000001", name: "Hero", system: { attributes: { hp: { value: 30, max: 30 } }, spells: { s1: { value: 2 } } },
    items: [{ _id: "ITEM000000000001", name: "Potion", system: { quantity: 2 } }], effects: [] });
  game.actors = new Coll();
  game.actors.set(hero.id, hero);
  const scene = new FakeScene();
  const goblinDelta = { _id: "GOB0000000000001", name: "Goblin", system: { attributes: { hp: { value: 7, max: 7 } } }, items: [], effects: [] };
  const mk = (data, actor) => {
    const token = new FakeToken(data, actor);
    token.scene = scene;
    scene.tokens.set(token.id, token);
  };
  mk({ _id: "TOKH000000000001", name: "Hero", x: 100, y: 100, hidden: false, actorLink: true, actorId: hero.id }, hero);
  mk({ _id: "TOKG000000000001", name: "Goblin", x: 500, y: 100, hidden: false, actorLink: false, delta: goblinDelta }, new FakeActor(goblinDelta));
  scene.walls.set("WALL000000000001", new Embedded({ _id: "WALL000000000001", door: 1, ds: 0 }));
  scene.walls.set("WALL000000000002", new Embedded({ _id: "WALL000000000002", door: 0, ds: 0 }));
  scene.lights.set("LIGH000000000001", new Embedded({ _id: "LIGH000000000001", hidden: false, x: 1, y: 1 }));
  game.scenes = new Coll();
  game.scenes.set(scene.id, scene);
  const combat = {
    id: "COMB000000000001", name: "Cave fight", round: 0, turn: null, scene,
    combatants: new Coll(),
    calls: [],
    async update(changes, options) { this.calls.push(["combat", clone(changes), options]); Object.assign(this, changes); },
    async updateEmbeddedDocuments(type, updates, options) {
      this.calls.push([type, clone(updates), options]);
      for (const update of updates) merge(this.combatants.get(update._id).data, { ...update, _id: undefined });
    },
    async createEmbeddedDocuments(type, creates) { for (const data of creates) this.combatants.set(data._id, new Combatant(data, scene)); }
  };
  class Combatant extends Embedded {
    constructor(data, sceneDoc) { super(data); this.sceneDoc = sceneDoc; }
    get token() { return this.sceneDoc.tokens.get(this.data.tokenId); }
    get actor() { return this.token?.actor ?? null; }
  }
  for (const [id, tokenId, initiative] of [["CMB1000000000001", "TOKH000000000001", 18], ["CMB2000000000001", "TOKG000000000001", 9]]) {
    combat.combatants.set(id, new Combatant({ _id: id, tokenId, initiative, defeated: false, hidden: false }, scene));
  }
  game.combats = new Coll();
  game.combats.set(combat.id, combat);
  game.playlists = new Coll();
  const sound = { id: "SND0000000000001", playing: true };
  const playlist = {
    id: "PLAY000000000001", sounds: new Coll([[sound.id, sound]]), plays: [], stops: [],
    async playSound(s) { this.plays.push(s.id); s.playing = true; },
    async stopSound(s) { this.stops.push(s.id); s.playing = false; }
  };
  game.playlists.set(playlist.id, playlist);
  return { hero, scene, combat, playlist, sound };
}

function virtualStorage() {
  const files = new Map();
  env.state.fetchImpl = async (url) => {
    const clean = url.split("?")[0].replace(/\/+/g, "/");
    return files.has(clean) ? createResponse({ ok: true, json: structuredClone(files.get(clean)) }) : createResponse({ ok: false, status: 404 });
  };
  env.state.uploadImpl = async (_source, target, file) => {
    const path = `${target}/${file.name}`.replace(/\/+/g, "/");
    files.set(path, JSON.parse(await file.text()));
    return { path };
  };
  return files;
}

function resetState() {
  env.state.notifications.info.length = 0;
  env.state.notifications.warn.length = 0;
  env.state.uploadCalls.length = 0;
  env.state.settingWrites.length = 0;
  env.state.settingsValues.clear();
  env.state.localizations.clear();
  env.game.settings.settings.clear();
  env.state.dialogConfirmResult = true;
  env.state.lastDialogConfirmOptions = null;
  env.game.release = { generation: 14, build: 370 };
  env.game.system = { id: "dnd5e", version: "5.3.3" };
  env.game.user.isGM = true;
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.STORE_LOCK_SETTING}`, { token: null, owner: null, expiresAt: 0, acquiredAt: null });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_INDEX_SETTING}`, { version: 1, snapshots: [] });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_AUTO_SETTING}`, true);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_KEEP_SETTING}`, 3);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, true);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_MUSIC_SETTING}`, true);
  __test__.resetModuleTranslationState();
}

test.beforeEach(resetState);
test.after(() => env.cleanup());

function fight(world) {
  // The state of a fight in progress: hit points gone, a condition, a door open, a token moved and a new one
  world.hero.system.attributes.hp.value = 4;
  world.hero.system.spells.s1.value = 0;
  world.hero.items.get("ITEM000000000001").data.system.quantity = 1;
  world.hero.effects.set("EFF0000000000001", new Embedded({ _id: "EFF0000000000001", name: "Prone", statuses: ["prone"], disabled: false }));
  const goblin = world.scene.tokens.get("TOKG000000000001");
  goblin.actor.system.attributes.hp.value = 0;
  goblin.actor.effects.set("EFF0000000000002", new Embedded({ _id: "EFF0000000000002", name: "Dead", statuses: ["dead"], disabled: false }));
  goblin.data.x = 900;
  world.scene.tokens.get("TOKH000000000001").data.x = 300;
  world.scene.tokens.get("TOKH000000000001").data.hidden = true;
  world.scene.walls.get("WALL000000000001").data.ds = 1;
  world.scene.lights.get("LIGH000000000001").data.hidden = true;
  world.combat.round = 3;
  world.combat.turn = 1;
  world.combat.combatants.get("CMB2000000000001").data.defeated = true;
  world.sound.playing = false;
}

test("the state is read before the combat updates, for linked and unlinked tokens", () => {
  const world = buildWorld();
  const saved = encounterService.captureState({ combat: world.combat, round: 1, turn: 0 });
  assert.equal(saved.scene.name, "Cave");
  assert.deepEqual([saved.combat.round, saved.combat.turn], [1, 0]);
  assert.deepEqual(saved.actors.map((a) => a.key).sort(), ["a:HERO000000000001", "t:TOKG000000000001"]);
  assert.equal(saved.actors.find((a) => a.key.startsWith("t:")).tokenId, "TOKG000000000001");
  assert.equal(saved.actors.find((a) => a.key.startsWith("a:")).tokenId, null);
  assert.equal(saved.tokens.length, 2);
  assert.deepEqual(saved.walls, [{ id: "WALL000000000001", ds: 0 }]);
  assert.equal(saved.lights.length, 1);
  assert.deepEqual(saved.sounds, [{ playlistId: "PLAY000000000001", soundId: "SND0000000000001" }]);
  const noMusic = encounterService.captureState({ combat: world.combat, music: false });
  assert.deepEqual(noMusic.sounds, []);
});

test("combat start saves a snapshot file and an index entry, only for a GM and when enabled", async () => {
  const world = buildWorld();
  const files = virtualStorage();
  env.game.user.isGM = false;
  assert.equal(await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 }), null);
  env.game.user.isGM = true;
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_AUTO_SETTING}`, false);
  assert.equal(await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 }), null);
  assert.equal(files.size, 0);
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_AUTO_SETTING}`, true);

  const meta = await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 });
  assert.equal(meta.kind, "start");
  assert.equal(meta.path.startsWith("encounters/"), true);
  const [path] = [...files.keys()];
  assert.equal(path.endsWith(`/scbr/${meta.path}`), true);
  assert.equal(env.state.createDirectoryCalls.some((call) => call.target.endsWith("/scbr/encounters")), true);
  assert.equal(files.get(path).data.scene.id, world.scene.id);
  const index = encounterService.listSnapshots();
  assert.equal(index.length, 1);
  assert.equal(index[0].counts.actors, 2);
  assert.equal(env.state.notifications.info.length, 1);
  const loaded = await encounterService.loadSnapshot(index[0]);
  assert.equal(loaded.data.combat.round, 1);
  // the index setting holds numbers only, no scene data
  assert.equal(JSON.stringify(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_INDEX_SETTING}`)).includes("TOKH"), false);
});

test("only the newest N snapshots are kept and the dropped files are emptied", async () => {
  const world = buildWorld();
  const files = virtualStorage();
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const meta = await encounterService.saveCurrent(world.combat, { kind: "manual", name: `S${i}` });
    // distinct creation times, newest last
    ids.push(meta.id);
    const index = env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.ENCOUNTER_INDEX_SETTING}`);
    index.snapshots.find((entry) => entry.id === meta.id).createdAt = `2026-01-0${i + 1}T00:00:00.000Z`;
  }
  assert.equal(encounterService.listSnapshots().length, 3);
  assert.deepEqual(encounterService.listSnapshots().map((m) => m.name), ["S4", "S3", "S2"]);
  const emptied = [...files.values()].filter((file) => file.removed === true);
  assert.equal(emptied.length, 2);
  assert.equal(emptied.every((file) => file.data === undefined), true);
  await assert.rejects(() => encounterService.loadSnapshot({ id: ids[0], name: "S0", path: `encounters/${ids[0]}.json` }));
  assert.equal(await encounterService.deleteSnapshot(ids[4]), true);
  assert.equal(await encounterService.deleteSnapshot("missing"), false);
});

test("a reset puts the fight back: linked and unlinked actors, tokens, doors, lights, combat and music", async () => {
  const world = buildWorld();
  virtualStorage();
  const start = await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 });
  fight(world);
  // a token and an actor outside the snapshot
  world.scene.tokens.set("TOKX000000000001", Object.assign(new FakeToken({ _id: "TOKX000000000001", name: "Summon", x: 1, y: 1, actorLink: true, actorId: "NONE" }, null), { scene: world.scene }));
  const bystander = new FakeActor({ _id: "BYST000000000001", name: "Bystander", system: { attributes: { hp: { value: 1 } } } });
  game.actors.set(bystander.id, bystander);

  env.state.dialogConfirmResult = true;
  const result = await encounterService.restoreSnapshot(start.id);
  assert.equal(result.done, true);
  assert.equal(result.remaining, 0);
  assert.equal(world.hero.system.attributes.hp.value, 30);
  assert.equal(world.hero.system.spells.s1.value, 2);
  assert.equal(world.hero.items.get("ITEM000000000001").data.system.quantity, 2);
  assert.equal(world.hero.effects.size, 0);
  const goblin = world.scene.tokens.get("TOKG000000000001");
  assert.equal(goblin.actor.system.attributes.hp.value, 7);
  assert.equal(goblin.actor.effects.size, 0);
  assert.equal(goblin.data.x, 500);
  assert.equal(world.scene.tokens.get("TOKH000000000001").data.x, 100);
  assert.equal(world.scene.tokens.get("TOKH000000000001").data.hidden, false);
  assert.equal(world.scene.walls.get("WALL000000000001").data.ds, 0);
  assert.equal(world.scene.lights.get("LIGH000000000001").data.hidden, false);
  assert.deepEqual([world.combat.round, world.combat.turn], [1, 0]);
  assert.equal(world.combat.combatants.get("CMB2000000000001").data.defeated, false);
  assert.equal(world.sound.playing, true);
  assert.deepEqual(world.playlist.plays, ["SND0000000000001"]);
  // nothing outside the snapshot was touched
  assert.equal(bystander.system.attributes.hp.value, 1);
  assert.equal(bystander.calls.length, 0);
  assert.equal(world.scene.tokens.has("TOKX000000000001"), true);
  // the reset was confirmed with a summary and saved a "before reset" copy first
  assert.match(env.state.lastDialogConfirmOptions.content, /scbr-encounter-summary/);
  const kinds = encounterService.listSnapshots().map((m) => m.kind).sort();
  assert.deepEqual(kinds, ["safety", "start"]);
  // a second reset has nothing to do
  const again = await encounterService.restoreSnapshot(start.id, { confirm: false });
  assert.equal(again.done, false);
  assert.equal(again.summary.empty, true);
});

test("a cancelled confirmation changes nothing, a removed token and a dead unlinked token come back", async () => {
  const world = buildWorld();
  virtualStorage();
  const start = await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 });
  fight(world);
  env.state.dialogConfirmResult = false;
  const before = JSON.stringify(world.scene.tokens.map((t) => t.data));
  const cancelled = await encounterService.restoreSnapshot(start.id);
  assert.equal(cancelled.done, false);
  assert.equal(JSON.stringify(world.scene.tokens.map((t) => t.data)), before);
  assert.equal(encounterService.listSnapshots().length, 1);

  world.scene.tokens.delete("TOKG000000000001");
  await encounterService.restoreSnapshot(start.id, { confirm: false, removeAddedTokens: true });
  const back = world.scene.tokens.get("TOKG000000000001");
  assert.ok(back);
  assert.equal(back.data.x, 500);
  // the call used the saved id
  const create = world.scene.calls.find((call) => call[0] === "create" && call[1] === "Token");
  assert.equal(create[3].keepId, true);
});

test("without the safety setting no copy is made, a missing scene stops the reset", async () => {
  const world = buildWorld();
  virtualStorage();
  const start = await encounterService.onCombatStart(world.combat, { round: 1, turn: 0 });
  fight(world);
  env.game.settings.settings.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, {});
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.SAFETY_BACKUP_SETTING}`, false);
  await encounterService.restoreSnapshot(start.id, { confirm: false });
  assert.equal(encounterService.listSnapshots().length, 1);
  game.scenes = new Coll();
  await assert.rejects(() => encounterService.restoreSnapshot(start.id, { confirm: false }), /no longer exists|Cave/);
  await assert.rejects(() => encounterService.restoreSnapshot("nope"), /nope/);
});

test("the module settings and the combat tracker entries are registered", async () => {
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/en.json", {});
  env.mockFetchJson("modules/sephrals-content-backup-restore/lang/de.json", {});
  await env.hooks.trigger("init");
  const keys = env.state.registerCalls.filter((entry) => entry.moduleId === __test__.MODULE_ID).map((entry) => entry.settingKey);
  for (const key of [__test__.ENCOUNTER_INDEX_SETTING, __test__.ENCOUNTER_AUTO_SETTING, __test__.ENCOUNTER_KEEP_SETTING, __test__.ENCOUNTER_MUSIC_SETTING]) {
    assert.equal(keys.includes(key), true, key);
  }
  const index = env.state.registerCalls.find((entry) => entry.settingKey === __test__.ENCOUNTER_INDEX_SETTING);
  assert.equal(index.config.config, false);
  assert.equal(env.state.registerCalls.find((entry) => entry.settingKey === __test__.ENCOUNTER_AUTO_SETTING).config.scope, "world");
  const entries = [];
  await env.hooks.trigger("getCombatContextOptions", { viewed: { id: "C" } }, entries);
  assert.equal(entries.length >= 3, true);
  for (const entry of entries.filter((e) => /SCBR/.test(e.name ?? ""))) {
    assert.equal(typeof entry.callback, "function");
    assert.equal(typeof entry.onClick, "function");
    assert.equal(typeof entry.condition, "function");
    assert.equal(typeof entry.visible, "function");
    assert.equal(entry.icon.startsWith("<i"), true);
  }
});
