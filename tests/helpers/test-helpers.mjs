import path from "node:path";
import { pathToFileURL } from "node:url";

class TestStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }

  removeProperty(name) {
    this.values.delete(name);
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? "";
  }
}

class TestClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    for (const token of tokens) this.values.add(token);
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.values.has(token)) this.values.delete(token);
      else this.values.add(token);
      return this.values.has(token);
    }

    if (force) this.values.add(token);
    else this.values.delete(token);
    return force;
  }

  contains(token) {
    return this.values.has(token);
  }
}

export class TestHTMLElement {
  constructor() {
    this.dataset = {};
    this.style = new TestStyle();
    this.classList = new TestClassList();
    this.listeners = new Map();
    this.queryMap = new Map();
    this.queryAllMap = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.innerHTML = "";
    this.children = [];
  }

  addEventListener(type, handler) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type, handler) {
    const bucket = this.listeners.get(type) ?? [];
    this.listeners.set(type, bucket.filter((entry) => entry !== handler));
  }

  dispatch(type, event = {}) {
    const payload = {
      currentTarget: this,
      target: event.target ?? this,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event
    };

    for (const handler of this.listeners.get(type) ?? []) handler(payload);
    return payload;
  }

  querySelector(selector) {
    return this.queryMap.get(selector) ?? null;
  }

  querySelectorAll(selector) {
    return this.queryAllMap.get(selector) ?? [];
  }

  setQuerySelector(selector, element) {
    this.queryMap.set(selector, element);
  }

  setQuerySelectorAll(selector, elements) {
    this.queryAllMap.set(selector, elements);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(child) {
    this.children.push(child);
  }

  focus() {
    this.focused = true;
  }

  select() {
    this.selected = true;
  }
}

function createHooksStub() {
  const onceHandlers = new Map();
  const onHandlers = new Map();

  return {
    onceHandlers,
    onHandlers,
    once(event, handler) {
      const bucket = onceHandlers.get(event) ?? [];
      bucket.push(handler);
      onceHandlers.set(event, bucket);
    },
    on(event, handler) {
      const bucket = onHandlers.get(event) ?? [];
      bucket.push(handler);
      onHandlers.set(event, bucket);
    },
    async trigger(event, ...args) {
      const once = onceHandlers.get(event) ?? [];
      onceHandlers.delete(event);
      for (const handler of once) await handler(...args);
      for (const handler of onHandlers.get(event) ?? []) await handler(...args);
    }
  };
}

function interpolate(template, data = {}) {
  return String(template ?? "").replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = data[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

function getProperty(object, propertyPath) {
  return String(propertyPath ?? "").split(".").reduce((value, segment) => value?.[segment], object);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createResponse({ ok = true, status = 200, json = {}, text = "" } = {}) {
  return {
    ok,
    status,
    async json() {
      return typeof json === "function" ? json() : json;
    },
    async text() {
      return typeof text === "function" ? text() : text;
    }
  };
}

function createCollection(contents = [], { createResult = null } = {}) {
  const items = [...contents];
  return {
    contents: items,
    get(id) {
      return items.find((entry) => entry.id === id) ?? null;
    },
    documentClass: {
      async create(data, options) {
        return typeof createResult === "function" ? createResult(data, options) : createResult;
      }
    }
  };
}

function gameKeyForDocument(documentName) {
  return {
    Scene: "scenes",
    Actor: "actors",
    Item: "items",
    JournalEntry: "journal",
    RollTable: "tables",
    Cards: "cards",
    Playlist: "playlists",
    Macro: "macros",
    Combat: "combats"
  }[documentName];
}

export function modulePath(relativePath) {
  const absolute = path.resolve("d:\\_Projekte\\_Foundry-Development\\FoundryVTT_Module\\sephrals-content-backup-restore", relativePath);
  return pathToFileURL(absolute).href;
}

export async function importModule(relativePath) {
  return import(`${modulePath(relativePath)}?t=${Date.now()}-${Math.random()}`);
}

export async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

export function createTestEnvironment() {
  const state = {
    registerCalls: [],
    registerMenuCalls: [],
    settingWrites: [],
    settingsValues: new Map(),
    settingsRegistry: new Map(),
    localizations: new Map(),
    notifications: { info: [], warn: [], error: [] },
    fetchCalls: [],
    fetchResponses: new Map(),
    fetchImpl: null,
    createDirectoryCalls: [],
    createDirectoryErrors: new Map(),
    uploadCalls: [],
    uploadResult: null,
    uploadImpl: null,
    browseCalls: [],
    dialogWaitResult: null,
    dialogConfirmResult: true,
    lastDialogWaitOptions: null,
    lastDialogConfirmOptions: null,
    windowOpenCalls: [],
    renderedApps: [],
    appClosed: [],
    canvasDrawCalls: 0,
    randomIdCounter: 0,
    appendedHeadElements: []
  };

  const originalGlobals = {
    Hooks: globalThis.Hooks,
    game: globalThis.game,
    ui: globalThis.ui,
    foundry: globalThis.foundry,
    FilePicker: globalThis.FilePicker,
    fetch: globalThis.fetch,
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    canvas: globalThis.canvas
  };

  const hooks = createHooksStub();

  const documentHead = new TestHTMLElement();
  const documentStub = {
    head: documentHead,
    styleSheets: [],
    createElement(tagName) {
      const element = new TestHTMLElement();
      element.tagName = String(tagName).toUpperCase();
      return element;
    },
    querySelector(selector) {
      if (/^link\[data-sephrals-content-backup-restore-styles\]$/.test(selector)) {
        return state.appendedHeadElements.find((entry) => entry.attributes.get("data-sephrals-content-backup-restore-styles") === "true") ?? null;
      }
      return null;
    }
  };
  documentHead.append = (child) => {
    state.appendedHeadElements.push(child);
  };

  class ApplicationV2 {
    constructor() {
      this.element = new TestHTMLElement();
    }

    async render(options) {
      state.renderedApps.push({ app: this, options });
      return this;
    }

    async close(options) {
      state.appClosed.push({ app: this, options });
      return this;
    }
  }

  const foundry = {
    utils: {
      deepClone(value) {
        return structuredClone(value);
      },
      escapeHTML: escapeHtml,
      getProperty,
      randomID() {
        state.randomIdCounter += 1;
        return `random-${state.randomIdCounter}`;
      }
    },
    applications: {
      api: {
        ApplicationV2,
        DialogV2: {
          async wait(options) {
            state.lastDialogWaitOptions = options;
            return typeof state.dialogWaitResult === "function" ? state.dialogWaitResult(options) : state.dialogWaitResult;
          },
          async confirm(options) {
            state.lastDialogConfirmOptions = options;
            return typeof state.dialogConfirmResult === "function" ? state.dialogConfirmResult(options) : state.dialogConfirmResult;
          }
        }
      },
      apps: {
        FilePicker: {
          implementation: {
            async createDirectory(source, target, options) {
              state.createDirectoryCalls.push({ source, target, options });
              const error = state.createDirectoryErrors.get(target);
              if (error) throw error;
              return { source, target };
            }
          }
        }
      }
    }
  };

  const ui = {
    notifications: {
      info(message) {
        state.notifications.info.push(message);
      },
      warn(message) {
        state.notifications.warn.push(message);
      },
      error(message) {
        state.notifications.error.push(message);
      }
    }
  };

  const game = {
    i18n: {
      lang: "en",
      localize(key) {
        return state.localizations.get(key) ?? key;
      },
      format(key, data) {
        return interpolate(state.localizations.get(key) ?? key, data);
      }
    },
    settings: {
      settings: new Map(),
      register(moduleId, settingKey, config) {
        state.registerCalls.push({ moduleId, settingKey, config });
        this.settings.set(`${moduleId}.${settingKey}`, config);
        state.settingsRegistry.set(`${moduleId}.${settingKey}`, config);
        if (!state.settingsValues.has(`${moduleId}.${settingKey}`)) {
          state.settingsValues.set(`${moduleId}.${settingKey}`, structuredClone(config.default));
        }
      },
      registerMenu(moduleId, key, config) {
        state.registerMenuCalls.push({ moduleId, key, config });
      },
      get(moduleId, settingKey) {
        return state.settingsValues.get(`${moduleId}.${settingKey}`);
      },
      async set(moduleId, settingKey, value) {
        state.settingWrites.push({ moduleId, settingKey, value });
        state.settingsValues.set(`${moduleId}.${settingKey}`, structuredClone(value));
        return value;
      }
    },
    modules: new Map([["sephrals-content-backup-restore", { version: "1.0.1" }]]),
    release: { generation: 14 },
    world: { id: "test-world", title: "Test World" },
    user: { id: "gm-user", isGM: true },
    folders: {
      get() {
        return null;
      }
    }
  };

  const emptyCollection = () => createCollection();
  game.scenes = emptyCollection();
  game.actors = emptyCollection();
  game.items = emptyCollection();
  game.journal = emptyCollection();
  game.tables = emptyCollection();
  game.cards = emptyCollection();
  game.playlists = emptyCollection();
  game.macros = emptyCollection();
  game.combats = emptyCollection();

  const filePicker = {
    async upload(source, target, file, body, options) {
      state.uploadCalls.push({ source, target, file, body, options });
      if (typeof state.uploadImpl === "function") return state.uploadImpl(source, target, file, body, options);
      return state.uploadResult ?? { path: `${target}/${file.name}` };
    },
    async browse(source, target, options) {
      state.browseCalls.push({ source, target, options });
      return { dirs: [], files: [] };
    }
  };

  const windowStub = {
    innerHeight: 1000,
    open(url, target, features) {
      state.windowOpenCalls.push({ url, target, features });
    }
  };

  globalThis.Hooks = hooks;
  globalThis.game = game;
  globalThis.ui = ui;
  globalThis.foundry = foundry;
  globalThis.FilePicker = filePicker;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    state.fetchCalls.push({ url, init });
    if (typeof state.fetchImpl === "function") return state.fetchImpl(url, init);
    return state.fetchResponses.get(url) ?? createResponse({ ok: false, status: 404 });
  };
  globalThis.document = documentStub;
  globalThis.window = windowStub;
  globalThis.HTMLElement = TestHTMLElement;
  globalThis.canvas = {
    scene: { id: "scene-1" },
    async draw() {
      state.canvasDrawCalls += 1;
    }
  };

  return {
    state,
    hooks,
    game,
    ui,
    foundry,
    setCollection(documentName, contents, options = {}) {
      const key = gameKeyForDocument(documentName);
      const collection = createCollection(contents, options);
      game[key] = collection;
      return collection;
    },
    mockFetchJson(url, json, options = {}) {
      state.fetchResponses.set(url, createResponse({ ok: true, status: 200, json, ...options }));
    },
    mockFetchFailure(url, status = 404) {
      state.fetchResponses.set(url, createResponse({ ok: false, status }));
    },
    cleanup() {
      globalThis.Hooks = originalGlobals.Hooks;
      globalThis.game = originalGlobals.game;
      globalThis.ui = originalGlobals.ui;
      globalThis.foundry = originalGlobals.foundry;
      globalThis.FilePicker = originalGlobals.FilePicker;
      globalThis.fetch = originalGlobals.fetch;
      globalThis.document = originalGlobals.document;
      globalThis.window = originalGlobals.window;
      globalThis.HTMLElement = originalGlobals.HTMLElement;
      globalThis.canvas = originalGlobals.canvas;
    }
  };
}