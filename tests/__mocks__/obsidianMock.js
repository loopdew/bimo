const createDivResult = {
  setText: () => {},
  style: {},
  addEventListener: () => {},
  setAttr: () => {},
  hide: () => {},
  createDiv: () => createDivResult,
  createEl: () => ({ addEventListener: () => {}, setAttr: () => {}, setText: () => {} }),
};

module.exports = {
  Platform: {
    isMacOS: true,
    isIosApp: false,
  },
  Menu: class {},
  Notice: class {},
  /**
   * Real Obsidian replaces the element's content with an SVG icon from the
   * Lucide set. The mock records the icon id instead, which is enough for tests
   * that assert "a button was created for each tool".
   */
  setIcon: (el, icon) => {
    if (el && el.setAttribute) el.setAttribute('data-icon', icon);
  },
  TextFileView: class {
    constructor(leaf) {
      this.leaf = leaf;
      this.file = null;
      // Minimal containerEl used by some views during `setViewData`.
      this.containerEl = {
        children: [],
        appendChild: () => {},
      };
    }
    getViewType() {
      return '';
    }
    setViewData() {}
    clear() {}
  },
  Modal: class {
    constructor() {
      this.titleEl = { setText: () => {} };
      this.contentEl = {
        empty: () => {},
        createEl: () => ({ addEventListener: () => {}, setAttr: () => {}, setText: () => {} }),
        createDiv: () => createDivResult,
        addClass: () => {},
      };
    }
    open() {}
    close() {}
  },
  TFile: class {
    constructor() {
      this.vault = {
        read: async () => '',
        cachedRead: async () => '',
        on: () => ({}),
        offref: () => {},
      };
    }
  },
  Vault: class {},
  // The settings tab extends this at module scope, so a missing mock turns any
  // test that transitively imports the tab into "Class extends value undefined"
  // before a single assertion runs.
  Plugin: class {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest ?? { id: 'bimo', version: '0.0.0' };
    }
    addCommand() {}
    addSettingTab() {}
    addRibbonIcon() {}
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
  },
  PluginSettingTab: class {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = createDivResult;
    }
    display() {}
  },
  MarkdownRenderChild: class {
    constructor(containerEl) {
      this.containerEl = containerEl;
    }
    load() {}
    unload() {}
  },
  normalizePath: (path) => path.replace(/\\/g, '/'),
  // Live eval tests call portal jobs through almostUsefulRequestJson.
  requestUrl: async ({ url, method = 'GET', headers = {}, body, throw: shouldThrow }) => {
    const response = await fetch(url, { method, headers, body });
    const text = await response.text();
    if (shouldThrow && response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return { status: response.status, text, headers: response.headers };
  },
  Setting: class {
    constructor() {}
    setName() { return this; }
    setDesc() { return this; }
    setClass() { return this; }
    addText(cb) { cb({ setValue: () => this, setPlaceholder: () => this, inputEl: { addEventListener: () => {} } }); return this; }
    addToggle(cb) { cb({ setValue: () => this, onChange: () => this }); return this; }
    addButton(cb) { cb({ setButtonText: () => this, setClass: () => this, setWarning: () => this, setCta: () => this, onClick: () => this }); return this; }
  },
};


