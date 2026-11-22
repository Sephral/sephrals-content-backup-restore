import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment } from "./helpers/test-helpers.mjs";

createTestEnvironment();
const { __test__ } = await import("../scripts/sample-windows.js");
const { sampleBackups, sampleSnapshots, sampleSummary } = __test__;

const NOW = Date.parse("2026-11-22T20:00:00Z");
const world = { coreGeneration: 14, coreBuild: 370, systemId: "dnd5e", systemVersion: "6.0.6" };

test("sample backups are made up, newest first and cover live and deleted documents", () => {
  const list = sampleBackups({ now: NOW, world });
  assert.ok(list.length >= 6);
  assert.equal(list.filter((entry) => !entry.backup.name && !entry.backup.createdAt).length, 1);
  const dates = list.map((entry) => entry.backup.createdAt).filter(Boolean);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(list.some((entry) => entry.document === null));
  assert.ok(list.some((entry) => entry.document));
  assert.equal(new Set(list.map((entry) => entry.backup.id)).size, list.length);
  assert.ok(list.every((entry) => entry.backup.documentId.startsWith("sample")));
  assert.ok(list.every((entry) => !("data" in entry.backup)));
});

test("one sample backup was made with an older Foundry", () => {
  const list = sampleBackups({ now: NOW, world });
  const older = list.filter((entry) => entry.backup.coreGeneration !== world.coreGeneration);
  assert.equal(older.length, 1);
  assert.equal(older[0].backup.coreGeneration, 13);
});

test("sample snapshots carry counts, one belongs to a missing scene", () => {
  const list = sampleSnapshots({ now: NOW, world });
  assert.equal(list.length, 4);
  assert.ok(list.every((meta) => meta.counts.tokens > 0 && meta.path.endsWith(".json")));
  assert.deepEqual([...new Set(list.map((meta) => meta.kind))].sort(), ["manual", "safety", "start"]);
  assert.equal(list.filter((meta) => meta.sceneId === "sampleGone").length, 1);
  assert.equal(list[0].counts.effects, 2);
});

test("the sample summary has the longer variant with notes", () => {
  assert.equal(sampleSummary().missingActors, 0);
  assert.equal(sampleSummary({ full: true }).missingActors, 1);
  assert.equal(sampleSummary().empty, false);
});
