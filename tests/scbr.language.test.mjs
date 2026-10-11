import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createResponse, createTestEnvironment, importModule } from "./helpers/test-helpers.mjs";

const bundledEn = JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8"));
const bundledDe = JSON.parse(await readFile(new URL("../lang/de.json", import.meta.url), "utf8"));

async function setupLanguage({ foundryLanguage, setting, localizations = {} }) {
  const env = createTestEnvironment();
  env.game.i18n.lang = foundryLanguage;
  for (const [key, value] of Object.entries(localizations)) env.state.localizations.set(key, value);
  env.game.settings.settings.set("sephrals-content-backup-restore.uiLanguage", {});
  env.state.settingsValues.set("sephrals-content-backup-restore.uiLanguage", setting);
  env.state.fetchImpl = async (url) => {
    if (url.endsWith("/lang/en.json")) return createResponse({ ok: true, json: structuredClone(bundledEn) });
    if (url.endsWith("/lang/de.json")) return createResponse({ ok: true, json: structuredClone(bundledDe) });
    return createResponse({ ok: false, status: 404 });
  };

  const { __test__ } = await importModule("scripts/scbr.js");
  await __test__.ensureModuleTranslationsLoaded();
  return { env, __test__ };
}

test("Follow Foundry with a community language returns the game.i18n value, not the bundled English JSON", async () => {
  assert.equal(bundledEn["scbr.action.cancel"], "Cancel");
  assert.equal(bundledEn["scbr.dialog.create.summary"], "Create a new backup for {documentName}.");

  const { env, __test__ } = await setupLanguage({
    foundryLanguage: "fr",
    setting: "default",
    localizations: {
      "scbr.action.cancel": "Annuler",
      "scbr.dialog.create.summary": "Créer une nouvelle sauvegarde pour {documentName}."
    }
  });

  try {
    assert.equal(__test__.MODULE_TRANSLATION_CACHE.get("en")?.["scbr.action.cancel"], "Cancel");
    assert.equal(__test__.getOverrideLanguage(), null);
    assert.equal(__test__.localize("scbr.action.cancel", "Cancel"), "Annuler");
    assert.equal(__test__.format("scbr.dialog.create.summary", { documentName: "Scène" }, "fallback"), "Créer une nouvelle sauvegarde pour Scène.");
    // Keys without a community translation still go through game.i18n, which falls back to the module's English file.
    assert.equal(__test__.localize("scbr.missing.key", "Fallback"), "Fallback");
  } finally {
    env.cleanup();
  }
});

test("Follow Foundry applies no bundled override for en/de either", async () => {
  const { env, __test__ } = await setupLanguage({
    foundryLanguage: "de",
    setting: "default",
    localizations: { "scbr.action.cancel": "Abbrechen (Welt)" }
  });

  try {
    __test__.MODULE_TRANSLATION_CACHE.get("de")["scbr.action.cancel"] = "Abbrechen (Modul)";
    assert.equal(__test__.localize("scbr.action.cancel", "Cancel"), "Abbrechen (Welt)");
    assert.equal(__test__.localize("scbr.action.cancel", "Cancel", "default"), "Abbrechen (Welt)");
  } finally {
    env.cleanup();
  }
});

test("an explicit module language still overrides game.i18n with the bundled JSON", async () => {
  const { env, __test__ } = await setupLanguage({
    foundryLanguage: "fr",
    setting: "de",
    localizations: {
      "scbr.action.cancel": "Annuler",
      "scbr.only.in.foundry": "Seulement Foundry"
    }
  });

  try {
    assert.equal(__test__.getOverrideLanguage(), "de");
    assert.equal(__test__.localize("scbr.action.cancel", "Cancel"), bundledDe["scbr.action.cancel"]);
    assert.equal(__test__.format("scbr.dialog.create.summary", { documentName: "Szene" }, "fallback"), bundledDe["scbr.dialog.create.summary"].replace("{documentName}", "Szene"));
    // Missing bundled keys fall back to game.i18n.
    assert.equal(__test__.localize("scbr.only.in.foundry", "Fallback"), "Seulement Foundry");
    // An explicit languageOverride argument still wins over the setting.
    assert.equal(__test__.localize("scbr.action.cancel", "Cancel", "en"), "Cancel");
    assert.equal(__test__.getBackupDisplayParts({ name: "", createdAt: null }, "en").name, bundledEn["scbr.backup.unnamed"]);
  } finally {
    env.cleanup();
  }
});

test("locale formatting follows game.i18n.lang unless a module language is chosen", async () => {
  const { env, __test__ } = await setupLanguage({ foundryLanguage: "fr", setting: "default" });
  const createdAt = "2024-05-04T12:30:00.000Z";

  try {
    assert.equal(__test__.getLocaleForModule(), "fr");
    assert.equal(__test__.getTimestampString(createdAt), new Date(createdAt).toLocaleString("fr"));
    assert.equal(__test__.getTimestampString(createdAt, "de"), new Date(createdAt).toLocaleString("de"));

    env.game.i18n.lang = "pt_BR";
    assert.equal(__test__.getLocaleForModule("default"), "pt-BR");
    env.game.i18n.lang = "not a locale!";
    assert.equal(__test__.getLocaleForModule("default"), "en");
    env.game.i18n.lang = "";
    assert.equal(__test__.getFoundryLocale(), "en");

    env.state.settingsValues.set("sephrals-content-backup-restore.uiLanguage", "de");
    env.game.i18n.lang = "fr";
    assert.equal(__test__.getLocaleForModule(), "de");
    assert.equal(__test__.getLocaleForModule("en"), "en");
  } finally {
    env.cleanup();
  }
});
