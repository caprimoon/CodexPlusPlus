import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const source = await readFile(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");

function functionSource(name: string) {
  const matches = Array.from(source.matchAll(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "gm")));
  assert.ok(matches.length, `missing ${name}`);
  return matches.at(-1)![0];
}

function styleNode() {
  const values = new Map<string, string>();
  return {
    left: "", top: "", right: "", bottom: "",
    setProperty(name: string, value: string) { values.set(name, value); },
    removeProperty(name: string) { values.delete(name); },
    values,
  };
}

function layoutHarness(zoom = 1) {
  const nodes: Record<string, { rect: Record<string, number>; getBoundingClientRect(): Record<string, number> }> = {};
  const rectangles: Record<string, Record<string, number>> = {
    main: { left: 320, top: 40, width: 960, height: 760, right: 1280 },
    "aside.app-shell-left-panel": { left: 0, top: 40, width: 320, height: 760, right: 320 },
    "nav[data-app-navigation-rail]": { left: 0, top: 40, width: 62, height: 760, right: 62 },
    "[data-app-shell-workspace-row]": { left: 0, top: 40, width: 962, height: 740, right: 962, bottom: 780 },
  };
  for (const [selector, rect] of Object.entries(rectangles)) {
    nodes[selector] = { rect, getBoundingClientRect() { return this.rect; } };
  }
  const style = styleNode();
  const overlay = { style, isConnected: true, classList: { contains: (name: string) => name === "codex-plus-page-overlay" } };
  const listeners = new Set<() => void>();
  const observers: Observer[] = [];
  class Observer {
    targets = new Set<unknown>();
    disconnects = 0;
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; observers.push(this); }
    observe(node: unknown) { this.targets.add(node); }
    disconnect() { this.disconnects++; this.targets.clear(); }
  }
  const window: Record<string, unknown> = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener(_event: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_event: string, listener: () => void) { listeners.delete(listener); },
  };
  const document = {
    querySelector: (selector: string) => nodes[selector] ?? null,
    querySelectorAll: () => overlay.isConnected ? [{ remove() { overlay.isConnected = false; } }] : [],
  };
  const runtime = new Function("document", "window", "ResizeObserver", "codexPlusWindowZoom", `
    const codexPlusPageClass = "codex-plus-page-overlay";
    const codexPlusRailSelector = "nav[data-app-navigation-rail]";
    function setCodexPlusSidebarNavActive() {}
    // 返回按钮行为由 page-back-navigation.test.ts 验证，此处只隔离布局生命周期。
    function syncCodexPlusPageBackButton() {}
    function restoreCodexPlusPageBackButton() {}
    ${functionSource("positionCodexPlusPage")}
    ${functionSource("observeCodexPlusPageLayout")}
    ${functionSource("closeCodexPlusPage")}
    return { position: positionCodexPlusPage, attach: observeCodexPlusPageLayout, close: closeCodexPlusPage };
  `)(document, window, Observer, () => zoom) as {
    position(node: typeof overlay): void; attach(node: typeof overlay): void; close(): void;
  };
  return { ...runtime, overlay, nodes, listeners, observers, window, document };
}

it("keeps panel edges in layout coordinates without rewriting zoom during positioning", () => {
  for (const zoom of [0.8, 1, 1.25]) {
    const h = layoutHarness(zoom);
    h.position(h.overlay);
    assert.equal(h.overlay.style.left, `${62 / zoom}px`);
    assert.equal(h.overlay.style.top, `${40 / zoom}px`);
    assert.equal(h.overlay.style.values.get("--codex-plus-page-top"), `${40 / zoom}px`);
    assert.equal(h.overlay.style.values.get("--codex-plus-page-right"), `${38 / zoom}px`);
    assert.equal(h.overlay.style.values.get("--codex-plus-page-bottom"), `${20 / zoom}px`);
    assert.equal(h.overlay.style.values.get("--codex-plus-zoom"), undefined);
    assert.equal(h.overlay.style.values.get("zoom"), undefined);
    delete h.nodes["nav[data-app-navigation-rail]"];
    h.position(h.overlay);
    assert.equal(h.overlay.style.left, `${320 / zoom}px`, "legacy sidebar boundary is unchanged");
    h.nodes.main.rect.height = 0;
    h.nodes["aside.app-shell-left-panel"].rect.top = 24;
    h.position(h.overlay);
    assert.equal(h.overlay.style.top, `${24 / zoom}px`);
    delete h.nodes.main;
    delete h.nodes["aside.app-shell-left-panel"];
    h.position(h.overlay);
    assert.equal(h.overlay.style.top, "0px");
    assert.equal(h.overlay.style.left, "0px");
  }
});

it("retargets the layout observer when the host replaces its main or rail", () => {
  const h = layoutHarness();
  h.attach(h.overlay);
  const observer = h.observers[0];
  assert.equal(observer.targets.size, 3);
  const oldRail = h.nodes["nav[data-app-navigation-rail]"];
  h.nodes["nav[data-app-navigation-rail]"] = {
    rect: { ...oldRail.rect, top: 60 },
    getBoundingClientRect() { return this.rect; },
  };
  h.position(h.overlay);
  assert.equal(observer.targets.has(oldRail), false);
  assert.equal(observer.targets.has(h.nodes["nav[data-app-navigation-rail]"]), true);
  assert.equal(h.overlay.style.top, "60px");
  const disconnects = observer.disconnects;
  h.position(h.overlay);
  assert.equal(observer.disconnects, disconnects, "unchanged hosts do not resubscribe");
});

it("closes and reopens pages without retaining observers, resize handlers or queued layout writes", () => {
  const h = layoutHarness();
  let cleanupCalls = 0;
  for (let i = 0; i < 50; i++) {
    h.overlay.isConnected = true;
    h.attach(h.overlay);
    assert.equal(h.listeners.size, 1);
    h.window.__codexPlusExtensionPageCleanup = () => { cleanupCalls++; };
    const observer = h.observers.at(-1)!;
    h.close();
    h.close();
    assert.equal(cleanupCalls, i + 1, "extension cleanup executes exactly once");
    assert.equal(h.listeners.size, 0);
    assert.equal(observer.targets.size, 0);
    assert.equal(h.window.__codexPlusPageResizeHandler, null);
    assert.equal(h.window.__codexPlusPageLayoutObserver, null);
    assert.equal(h.window.__codexPlusPageLayoutTargets, null);
    const top = h.overlay.style.top;
    h.nodes.main.rect.top += 1;
    observer.callback();
    assert.equal(h.overlay.style.top, top, "a queued callback cannot reposition a removed page");
  }
});

it("runs old extension cleanup before replacing a page with either a built-in page or a modal", () => {
  for (const page of [true, false]) {
    const h = layoutHarness();
    h.attach(h.overlay);
    let cleanups = 0;
    h.window.__codexPlusExtensionPageCleanup = () => { cleanups++; };
    const stop = new Error("stop before building the new DOM");
    const document = { ...h.document, createElement() { throw stop; } };
    const open = new Function("document", "closeCodexPlusPage", "codexPlusModalTab", `
      const codexPlusPageClass = "codex-plus-page-overlay";
      ${functionSource("openCodexPlusModal")}
      return openCodexPlusModal;
    `)(document, h.close, (tab: string) => tab);
    assert.throws(() => open({ page }), (error: unknown) => error === stop);
    assert.equal(cleanups, 1);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.observers[0].targets.size, 0);
  }
});

it("cleans up the previous extension before opening another extension page", () => {
  const h = layoutHarness();
  h.attach(h.overlay);
  let cleanups = 0;
  h.window.__codexPlusExtensionPageCleanup = () => { cleanups++; };
  const stop = new Error("stop before building the next extension DOM");
  const open = new Function("document", "closeCodexPlusPage", `
    const codexPlusPageClass = "codex-plus-page-overlay";
    ${functionSource("openCodexPlusModalForExtension")}
    return openCodexPlusModalForExtension;
  `)({ ...h.document, createElement() { throw stop; } }, h.close);
  assert.throws(() => open("next", {}), (error: unknown) => error === stop);
  assert.equal(cleanups, 1);
  assert.equal(h.listeners.size, 0);
});

it("keeps only the current rail entry selected and removes inactive aria-current attributes", () => {
  const buttons = Array.from({ length: 3 }, () => ({
    dataset: {} as Record<string, string>,
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    removeAttribute(name: string) { this.attributes.delete(name); },
  }));
  const ids = ["home", "extensions"];
  const document = {
    getElementById: (id: string) => {
      assert.equal(id, "sidebar", "retired plugin navigation must not be queried");
      return { querySelector: () => buttons[0] };
    },
    querySelector: (selector: string) => buttons[ids.findIndex(id => selector === `#${id} > button`) + 1],
  };
  const active = new Function("document", `
    const codexPlusSidebarNavId = "sidebar";
    const codexPlusRailNavId = "home";
    const codexPlusRailExtensionsId = "extensions";
    function syncCodexPlusRailNativeSelection() {}
    ${functionSource("setCodexPlusSidebarNavActive")}
    return setCodexPlusSidebarNavActive;
  `)(document);
  for (const entry of ids) {
    active(true, entry);
    for (const [index, button] of buttons.entries()) {
      const selected = (index === 0 ? "home" : ids[index - 1]) === entry;
      assert.equal(button.attributes.get("aria-current"), selected ? "page" : undefined);
      assert.equal(button.dataset.active, String(selected));
    }
  }
  active(false);
  for (const button of buttons) assert.equal(button.attributes.has("aria-current"), false);
});

it("replaces version 31 styles with bounded panel geometry and keeps reinjection idempotent", () => {
  const styleSource = functionSource("installStyle");
  const names = new Set([
    "styleId", "codexDeleteStyleVersion",
    ...Array.from(styleSource.matchAll(/\$\{([A-Za-z_$][A-Za-z0-9_$]*)/g), match => match[1]),
  ]);
  const declarations = [...names].map(name => {
    const match = source.match(new RegExp(`^  const ${name} = .+;$`, "m"))
      ?? source.match(new RegExp(`^  const ${name} = [\\s\\S]*?^  };$`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
  let existing: { dataset: Record<string, string>; textContent?: string; remove(): void } | null = {
    dataset: { codexDeleteStyleVersion: "31" },
    remove() { existing = null; },
  };
  let appended = 0;
  const document = {
    getElementById: () => existing,
    createElement: () => ({ dataset: {}, remove() { existing = null; } }),
    documentElement: { appendChild(node: NonNullable<typeof existing>) { existing = node; appended++; } },
  };
  const install = new Function("document", `${declarations}\n${styleSource}\nreturn installStyle;`)(document);
  install();
  assert.ok(Number(existing?.dataset.codexDeleteStyleVersion) >= 32);
  const pageRules = existing!.textContent!.match(/\.codex-plus-page-overlay\s*\{([^}]+)\}/)![1];
  assert.match(pageRules, /right: var\(--codex-plus-page-right, 0px\)/);
  assert.match(pageRules, /bottom: var\(--codex-plus-page-bottom, 0px\)/);
  assert.match(pageRules, /border-radius: var\(--codex-plus-page-radius, 0px\)/);
  assert.match(pageRules, /height: calc\(100vh \/ var\(--codex-plus-zoom, 1\) - var\(--codex-plus-page-top, 0px\) - var\(--codex-plus-page-bottom, 0px\)\)/);
  const modalRules = existing!.textContent!.match(/\.codex-plus-modal-overlay\s*\{([^}]+)\}/)![1];
  assert.match(modalRules, /height: calc\(100vh \/ var\(--codex-plus-zoom, 1\)\)/);
  install();
  assert.equal(appended, 1);
});

it("embeds into Codex Settings right content pane and auto-closes when Settings disappears", () => {
  const style = styleNode();
  let closeCalls = 0;
  let settingsPresent = true;
  const overlay = {
    style,
    isConnected: true,
    classList: { contains: (name: string) => name === "codex-plus-page-overlay" },
    getAttribute: (name: string) => name === "data-codex-plus-settings-embedded" ? "true" : null,
  };
  const sidebarNode = { getBoundingClientRect: () => ({ left: 62, top: 40, width: 260, height: 756, right: 322, bottom: 796 }) };
  const paneNode = { getBoundingClientRect: () => ({ left: 326, top: 44, width: 670, height: 752, right: 996, bottom: 796 }) };
  const railNode = { getBoundingClientRect: () => ({ left: 0, top: 40, width: 62, height: 760, right: 62, bottom: 800 }) };
  const mainNode = { getBoundingClientRect: () => ({ left: 320, top: 40, width: 960, height: 760, right: 1280, bottom: 800 }) };
  const rowNode = { getBoundingClientRect: () => ({ left: 0, top: 40, width: 996, height: 756, right: 996, bottom: 796 }) };
  const windowObj = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  const documentObj = {
    querySelector: (selector: string) => ({
      "aside.app-shell-left-panel": null,
      main: mainNode,
      "nav[data-app-navigation-rail]": railNode,
      "[data-app-shell-workspace-row]": rowNode,
      "main[data-app-shell-main-surface]": mainNode,
    } as Record<string, unknown>)[selector] ?? null,
    querySelectorAll: () => [],
  };
  const runtime = new Function("document", "window", "getComputedStyle", "codexPlusWindowZoom", "codexPlusSettingsContext", "closeCodexPlusPage", `
    const codexPlusPageClass = "codex-plus-page-overlay";
    const codexPlusRailSelector = "nav[data-app-navigation-rail]";
    const codexPlusSettingsEmbeddedAttr = "data-codex-plus-settings-embedded";
    ${functionSource("positionCodexPlusPage")}
    return { position: positionCodexPlusPage };
  `)(
    documentObj,
    windowObj,
    (target: unknown) => target === paneNode ? { borderTopLeftRadius: "12px" } : { borderTopLeftRadius: "" },
    () => 1,
    () => settingsPresent ? { sidebar: sidebarNode, contentPane: paneNode } : null,
    () => { closeCalls++; },
  ) as { position(node: typeof overlay): void };

  runtime.position(overlay);
  assert.equal(style.left, "326px", "right content pane starts after Settings sidebar");
  assert.equal(style.top, "44px");
  assert.equal(style.right, "4px");
  assert.equal(style.bottom, "4px");
  assert.equal(style.values.get("--codex-plus-page-radius"), "12px");
  assert.equal(closeCalls, 0);

  settingsPresent = false;
  runtime.position(overlay);
  assert.equal(closeCalls, 1, "leaving Settings automatically closes embedded pane");
});

it("inserts Codex++ group above 个人 in Settings, preserves extension rail entries, and filters on search", () => {
  class MockClassList {
    tokens = new Set<string>();
    constructor(initial = "") {
      initial.split(/\s+/).filter(Boolean).forEach((t) => this.tokens.add(t));
    }
    toggle(token: string, force?: boolean) {
      if (force === undefined) {
        if (this.tokens.has(token)) { this.tokens.delete(token); return false; }
        this.tokens.add(token); return true;
      }
      if (force) { this.tokens.add(token); return true; }
      this.tokens.delete(token); return false;
    }
    contains(token: string) { return this.tokens.has(token); }
    toString() { return [...this.tokens].join(" "); }
  }

  class MockEl {
    tagName: string;
    id = "";
    children: MockEl[] = [];
    parentElement: MockEl | null = null;
    attributes = new Map<string, string>();
    dataset: Record<string, string> = {};
    hidden = false;
    value = "";
    type = "button";
    _className = "";
    classList = new MockClassList();
    _text = "";
    listeners = new Map<string, Function[]>();
    style = {
      props: new Map<string, string>(),
      setProperty(k: string, v: string) { this.props.set(k, v); },
      removeProperty(k: string) { this.props.delete(k); },
    };
    rect = { left: 0, top: 40, width: 250, height: 700, right: 250, bottom: 740 };
    constructor(tagName = "div", attrs: Record<string, string> = {}, className = "") {
      this.tagName = tagName.toUpperCase();
      this.className = className;
      Object.entries(attrs).forEach(([k, v]) => this.setAttribute(k, v));
    }
    get className() { return this.classList.toString() || this._className; }
    set className(val: string) { this._className = val; this.classList = new MockClassList(val); }
    get textContent(): string { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
    set textContent(v: string) { this.children = []; this._text = v; }
    set innerHTML(html: string) {
      // Minimal parser for specs buttons `<span class="codex-plus-settings-nav-icon"...>...</span><span...>LABEL</span>`
      const textMatch = html.match(/<span[^>]*>([^<]+)<\/span>\s*$/);
      this._text = textMatch ? textMatch[1] : "";
    }
    get isConnected() {
      let cur: MockEl | null = this;
      while (cur) {
        if (cur === docRoot) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    get previousElementSibling(): MockEl | null {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      return idx > 0 ? this.parentElement.children[idx - 1] : null;
    }
    get nextElementSibling(): MockEl | null {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentElement.children.length ? this.parentElement.children[idx + 1] : null;
    }
    get firstElementChild(): MockEl | null { return this.children[0] ?? null; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
      if (name === "id") this.id = value;
      if (name.startsWith("data-")) {
        const camel = name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        this.dataset[camel] = value;
      }
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
      if (name.startsWith("data-")) {
        const camel = name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        delete this.dataset[camel];
      }
    }
    hasAttribute(name: string) { return this.attributes.has(name); }
    appendChild(child: MockEl) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    prepend(child: MockEl) { return this.insertBefore(child, this.children[0] ?? null); }
    insertBefore(child: MockEl, ref: MockEl | null) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
      child.parentElement = this;
      if (!ref) { this.children.push(child); return child; }
      const idx = this.children.indexOf(ref);
      if (idx === -1) this.children.push(child);
      else this.children.splice(idx, 0, child);
      return child;
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
    cloneNode(deep = false): MockEl {
      const copy = new MockEl(this.tagName, Object.fromEntries(this.attributes), this.className);
      copy._text = this._text;
      copy.rect = { ...this.rect };
      if (deep) this.children.forEach((c) => copy.appendChild(c.cloneNode(true)));
      return copy;
    }
    addEventListener(type: string, fn: Function) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    dispatch(type: string) {
      const event = { target: this, preventDefault() {}, stopPropagation() {} };
      (this.listeners.get(type) ?? []).forEach((fn) => fn(event));
    }
    getBoundingClientRect() { return this.rect; }
    contains(node: MockEl | null): boolean {
      if (!node) return false;
      let cur: MockEl | null = node;
      while (cur) { if (cur === this) return true; cur = cur.parentElement; }
      return false;
    }
    matches(selector: string): boolean {
      return selector.split(",").map((s) => s.trim()).some((part) => {
        if (!part || part === ":hover") return false;
        if (part === 'input[type="search"]') return this.tagName === "INPUT" && this.type === "search";
        if (part === 'input[type="text"]') return this.tagName === "INPUT" && this.type === "text";
        if (part === "input:not([type])") return this.tagName === "INPUT" && !this.hasAttribute("type");
        if (part === "[data-settings-panel-slug]") return this.hasAttribute("data-settings-panel-slug");
        if (part.startsWith("[") && part.endsWith("]")) {
          const eq = part.indexOf("=");
          if (eq === -1) return this.hasAttribute(part.slice(1, -1));
          const attr = part.slice(1, eq);
          const val = part.slice(eq + 1, -1).replace(/^"|"$/g, "");
          return this.getAttribute(attr) === val;
        }
        return false;
      });
    }
    querySelectorAll(selector: string): MockEl[] {
      const out: MockEl[] = [];
      const visit = (node: MockEl) => {
        for (const child of node.children) {
          if (selector === "#codex-plus-settings-section [data-codex-plus-settings-entry]") {
            if (child.hasAttribute("data-codex-plus-settings-entry") && node === docRoot || (child.hasAttribute("data-codex-plus-settings-entry") && findById("codex-plus-settings-section")?.contains(child))) {
              out.push(child);
            }
          } else if (selector === "[data-settings-panel-slug][data-codex-plus-suppressed-active]") {
            if (child.hasAttribute("data-settings-panel-slug") && child.hasAttribute("data-codex-plus-suppressed-active")) out.push(child);
          } else if (selector === "span, div") {
            if (child.tagName === "SPAN" || child.tagName === "DIV") out.push(child);
          } else if (child.matches(selector)) {
            out.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return out;
    }
    querySelector(selector: string): MockEl | null {
      if (selector.startsWith("#") && !selector.includes(" ")) return findById(selector.slice(1));
      return this.querySelectorAll(selector)[0] ?? null;
    }
    closest(selector: string): MockEl | null {
      let cur: MockEl | null = this;
      while (cur) { if (cur.matches(selector)) return cur; cur = cur.parentElement; }
      return null;
    }
  }

  const docRoot = new MockEl("html");
  function findById(id: string): MockEl | null {
    let found: MockEl | null = null;
    const walk = (node: MockEl) => {
      if (found) return;
      if (node.id === id) { found = node; return; }
      node.children.forEach(walk);
    };
    walk(docRoot);
    return found;
  }

  // Leftmost navigation rail with leftover built-in icons + extension LiveCanvas icon.
  const rail = new MockEl("nav", { "data-app-navigation-rail": "true" });
  const staleBuiltinNav = new MockEl("div", { id: "codex-plus-rail-nav" });
  const staleBuiltinExt = new MockEl("div", { id: "codex-plus-rail-extensions" });
  const liveCanvasExt = new MockEl("div", { id: "codex-plus-ext-rail-wallpaper", "data-codex-plus-ext-rail": "wallpaper", "data-codex-plus-ext": "user:live-wallpaper-studio" });
  rail.appendChild(staleBuiltinNav);
  rail.appendChild(staleBuiltinExt);
  rail.appendChild(liveCanvasExt);
  docRoot.appendChild(rail);

  // Settings split pane: sidebar (with search + 个人 section) and right contentPane.
  const settingsRow = new MockEl("div");
  settingsRow.rect = { left: 62, top: 44, width: 938, height: 756, right: 1000, bottom: 800 };
  const settingsSidebar = new MockEl("aside");
  settingsSidebar.rect = { left: 62, top: 44, width: 260, height: 756, right: 322, bottom: 800 };
  const searchInput = new MockEl("input");
  searchInput.type = "search";
  searchInput.rect = { left: 74, top: 80, width: 230, height: 32, right: 304, bottom: 112 };
  const list = new MockEl("div");
  list.rect = { left: 74, top: 120, width: 230, height: 600, right: 304, bottom: 720 };
  const personalGroup = new MockEl("div", {}, "settings-group");
  const personalHeading = new MockEl("div", {}, "settings-group-heading");
  personalHeading.textContent = "个人";
  const personalItems = new MockEl("div", {}, "settings-group-items");
  const generalBtn = new MockEl("button", { "data-settings-panel-slug": "general", "aria-current": "page" }, "nav-btn active-pill");
  generalBtn.textContent = "常规";
  const importBtn = new MockEl("button", { "data-settings-panel-slug": "import" }, "nav-btn");
  const importLabel = new MockEl("span", {}, "nav-label");
  importLabel.textContent = "导入";
  importBtn.appendChild(importLabel);
  personalItems.appendChild(generalBtn);
  personalItems.appendChild(importBtn);
  personalGroup.appendChild(personalHeading);
  personalGroup.appendChild(personalItems);
  list.appendChild(personalGroup);
  settingsSidebar.appendChild(searchInput);
  settingsSidebar.appendChild(list);

  const rightPane = new MockEl("div", {}, "_PageSurface_xyz");
  rightPane.rect = { left: 326, top: 44, width: 670, height: 752, right: 996, bottom: 796 };
  settingsRow.appendChild(settingsSidebar);
  settingsRow.appendChild(rightPane);
  docRoot.appendChild(settingsRow);

  const documentObj = {
    documentElement: docRoot,
    body: docRoot,
    getElementById: findById,
    createElement: (tag: string) => new MockEl(tag),
    querySelector: (selector: string) => {
      if (selector === "nav[data-app-navigation-rail]") return rail;
      if (selector.includes("codex-plus-page-overlay")) return docRoot.querySelector(".codex-plus-page-overlay") || currentOverlay;
      return docRoot.querySelector(selector);
    },
    querySelectorAll: (selector: string) => docRoot.querySelectorAll(selector),
  };

  let currentOverlay: MockEl | null = null;
  let openedTabs: Array<{ tab: string; settingsEmbedded?: boolean }> = [];

  const runtime = new Function(
    "document", "window", "Element", "getComputedStyle", "visibleElement",
    "markCodexPlusExtensionNode", "codexPlusNavEntryReusable", "escapeHtml",
    "openCodexPlusPage", "openCodexPlusExtensions", "closeCodexPlusPage",
    "closeCodexPlusPageAfterNativeNavigation", "syncCodexPlusRailNativeSelection", "positionCodexPlusPage",
    `
    const codexPlusMenuId = "codex-plus-menu";
    const codexPlusSidebarNavId = "codex-plus-sidebar-nav";
    const codexPlusRailNavId = "codex-plus-rail-nav";
    const codexPlusRailExtensionsId = "codex-plus-rail-extensions";
    const codexPlusRailPluginMarketId = "codex-plus-rail-plugin-market";
    const codexPlusRailSelector = "nav[data-app-navigation-rail]";
    const codexPlusSettingsSectionId = "codex-plus-settings-section";
    const codexPlusSettingsNavAttr = "data-codex-plus-settings-entry";
    const codexPlusSettingsEmbeddedAttr = "data-codex-plus-settings-embedded";
    const codexPlusSettingsPageOpenAttr = "data-codex-plus-settings-page-open";
    const codexPlusPageClass = "codex-plus-page-overlay";
    const codexPlusBackendGeneration = 1;
    const codexPlusDefaultExtensionIconPath = "M0 0h16v16H0z";
    const codexPlusExtensionConstants = { extensionAttribute: "data-codex-plus-ext" };
    ${functionSource("setCodexPlusSidebarNavActive")}
    ${functionSource("syncCodexPlusSettingsNativeSelection")}
    ${functionSource("removeCodexPlusBuiltinRailNavigation")}
    ${functionSource("installCodexPlusRailNavigation")}
    ${functionSource("isNativeSettingsNavItemSelected")}
    ${functionSource("codexPlusElementHasVisibleBackground")}
    ${functionSource("codexPlusSettingsContext")}
    ${functionSource("createCodexPlusSettingsHeadingNode")}
    ${functionSource("syncCodexPlusSettingsSectionSearch")}
    ${functionSource("installCodexPlusSettingsNavigation")}
    return { installRail: installCodexPlusRailNavigation, installSettings: installCodexPlusSettingsNavigation, setActive: setCodexPlusSidebarNavActive };
    `,
  )(
    documentObj,
    { innerWidth: 1000, innerHeight: 800 },
    MockEl,
    (node: MockEl) => node === generalBtn ? { backgroundColor: "rgb(45, 45, 45)", color: "rgb(255, 255, 255)", rowGap: "16px" } : { backgroundColor: "rgba(0, 0, 0, 0)", color: "rgb(180, 180, 180)", rowGap: "16px" },
    (node: MockEl) => !node.hidden && node.rect.width > 0 && node.rect.height > 0,
    () => {},
    () => true,
    (s: string) => s,
    (opts: { settingsEmbedded?: boolean } = {}) => { openedTabs.push({ tab: "home", settingsEmbedded: opts.settingsEmbedded }); },
    (opts: { settingsEmbedded?: boolean } = {}) => { openedTabs.push({ tab: "extensions", settingsEmbedded: opts.settingsEmbedded }); },
    () => { currentOverlay = null; },
    () => {},
    () => {},
    () => {},
  ) as { installRail(): boolean; installSettings(): boolean; setActive(active: boolean, entry?: string): void };

  // 1. Rail removes built-in icons while leaving LiveCanvas extension rail button untouched.
  assert.equal(runtime.installRail(), true);
  assert.equal(findById("codex-plus-rail-nav"), null);
  assert.equal(findById("codex-plus-rail-extensions"), null);
  assert.ok(findById("codex-plus-ext-rail-wallpaper"), "external extension rail entry stays in leftmost rail");

  // 2. Settings mounts Codex++ section as the top group right before 个人 without copying active-pill class.
  assert.equal(runtime.installSettings(), true);
  const section = findById("codex-plus-settings-section")!;
  assert.ok(section);
  assert.equal(list.children[0], section, "Codex++ section is placed at the very top");
  assert.equal(list.children[1], personalGroup);
  const buttons = section.querySelectorAll("[data-codex-plus-settings-entry]");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute("data-codex-plus-settings-entry"), "home");
  assert.equal(buttons[1].getAttribute("data-codex-plus-settings-entry"), "extensions");
  assert.equal(buttons[0].classList.contains("active-pill"), false);
  assert.equal(buttons[0].classList.contains("nav-btn"), true);

  // 3. Clicking items opens embedded Settings mode and manages active/suppressed states cleanly.
  buttons[1].dispatch("click");
  assert.deepEqual(openedTabs, [{ tab: "extensions", settingsEmbedded: true }]);
  currentOverlay = new MockEl("div", { "data-codex-plus-settings-embedded": "true" }, "codex-plus-page-overlay");
  runtime.setActive(true, "extensions");
  assert.equal(docRoot.getAttribute("data-codex-plus-settings-page-open"), "true");
  assert.equal(generalBtn.getAttribute("data-codex-plus-suppressed-active"), "true");
  assert.equal(buttons[1].dataset.active, "true");
  assert.equal(buttons[1].classList.contains("active-pill"), true);
  assert.equal(buttons[0].dataset.active, "false");

  runtime.setActive(false);
  assert.equal(docRoot.hasAttribute("data-codex-plus-settings-page-open"), false);
  assert.equal(generalBtn.hasAttribute("data-codex-plus-suppressed-active"), false);
  assert.equal(buttons[1].classList.contains("active-pill"), false);

  // 4. Settings search filters the Codex++ section cleanly.
  searchInput.value = "外部";
  searchInput.dispatch("input");
  assert.equal(buttons[0].hidden, true);
  assert.equal(buttons[1].hidden, false);
  assert.equal(section.hidden, false);

  searchInput.value = "unrelated-keyword";
  searchInput.dispatch("input");
  assert.equal(section.hidden, true);

  searchInput.value = "";
  searchInput.dispatch("input");
  assert.equal(section.hidden, false);
  assert.equal(buttons[0].hidden, false);
  assert.equal(buttons[1].hidden, false);
});
