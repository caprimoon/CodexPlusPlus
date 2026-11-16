import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { agentVisible, providersHidden, singleAgent } from "./agent-focus-model.ts";
import { pageVisibleForTool } from "./page-groups.ts";
import {
  extensionEnabledForHost,
  extensionHostForTool,
  extensionsForHost,
  extensionStateForHost,
  type ExtensionHost,
} from "./extension-host-model.ts";
import { defaultMarketSort, parseMarketTime, sortMarketScripts } from "./script-market-model.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const app = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function declaration(name: string): ts.VariableDeclaration {
  const topLevel = app.statements.flatMap((node) => ts.isVariableStatement(node) ? Array.from(node.declarationList.declarations) : [])
    .find((node) => node.name.getText(app) === name);
  if (topLevel) return topLevel;
  let result: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === name) result = node;
    ts.forEachChild(node, visit);
  };
  visit(app);
  assert.ok(result, name);
  return result;
}

function functionSource(name: string) {
  const node = app.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(node, name);
  return node.getText(app);
}

const navigationNames = [
  "routes", "routeTool", "globalNavigationRoutes", "gatewayNavigationRoutes", "managementNavigationRoutes",
  "navAliasRoute", "toolNavigationRoutes", "multiAgentRoutes", "providerRoutes", "strippedRoutes", "routeVisible", "visibleRoutes",
  "settingsModeRoutes", "customizeRoutes",
];
const navigationSource = navigationNames.map((name) => `const ${declaration(name).getText(app)};`).join("\n");
const icons = [...text.matchAll(/icon: (\w+)/g)].map((match) => match[1]);
const transpile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Element = { type: string | ((...args: any[]) => any); props: Record<string, any> };
function elements(node: any): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

function elementText(node: any): string {
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? elementText(node.props?.children) : "";
}

function harness() {
  const navigations: string[] = [];
  const context = vm.createContext({
    ...Object.fromEntries([...icons, "ChevronDown", "Search", "Plus", "AgentGlyph", "Loader2", "Square", "Play", "Sun", "Moon", "Languages", "ArrowUp", "ArrowLeft"].map((name) => [name, name])),
    React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
    t: (value: string) => value,
    tf: (value: string, args: unknown[]) => value.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
    agentName: (value: string) => value,
    singleAgent, providersHidden, pageVisibleForTool,
    useGatewayPayload: () => null,
    useState: () => [[], () => {}],
    loadCollapsedGroups: () => [],
    getLanguage: () => "zh",
    paletteShortcut: "Ctrl+K",
    APP_LOGO_URL: "logo.png",
    managerNavPages: () => [],
  });
  vm.runInContext(transpile(`const Fragment = "Fragment";\nconst navigationSections = [];\nconst agentTabGroups = () => [];\n${navigationSource}\n${functionSource("AppSidebar")}
    globalThis.sidebar = AppSidebar;
    globalThis.routes = routes;
    globalThis.codexLaunchVisible = (route, activeTool, extensionHost = "codex") => ${declaration("onCodexPage").initializer!.getText(app)};`), context);
  return {
    context,
    routes: context.routes as Array<{ id: string; tool?: string; tools?: string[] }>,
    navigations,
    sidebar: (activeTool: string, focus: "all" | "enhance" | "codex" = "all") => context.sidebar({
      tools: [{ id: activeTool, name: activeTool, switchable: true, relayCount: 0 }],
      activeTool, focus, soloAgent: singleAgent(focus), route: "overview", theme: "light", version: "test",
      codexRun: { running: true, busy: false, unavailableReason: null, onStart: () => {}, onStop: () => {} },
      claudeRun: { running: false, busy: false, unavailableReason: null, onStart: () => {}, onStop: () => {} },
      onNavigate: (route: string) => navigations.push(route),
    }) as Element,
  };
}

test("拓展管理仅向 Codex 开放", () => {
  const h = harness();
  const page = h.routes.find((route) => route.id === "userScripts");
  assert.ok(page);
  assert.equal(page.tool, "codex");
  assert.deepEqual(Array.from(page.tools!), ["codex"]);
  assert.deepEqual(Array.from(h.routes).filter((route) => route.tools).map((route) => route.id), ["userScripts"]);
  assert.equal(pageVisibleForTool(page, "codex"), true);
  for (const tool of ["claude", "grok", "opencode", "unknown"]) assert.equal(pageVisibleForTool(page, tool), false);
});

test("万物皆拓展是侧栏一级入口，点击跳转 userScripts；其他 Agent 不再展示", () => {
  const extensions = (sidebar: Element) => elements(sidebar).find((node) => node.props["data-nav"] === "extensions");
  const h = harness();
  const entry = extensions(h.sidebar("codex", "codex"));
  assert.ok(entry);
  entry.props.onClick();
  assert.deepEqual(h.navigations, ["userScripts"]);
  assert.equal(agentVisible("codex", "claude"), false);
});

test("全局管理入口保持保留", () => {
  const h = harness();
  const entries = elements(h.sidebar("codex", "codex"));
  for (const key of ["customize", "sessions"]) {
    assert.ok(entries.some((node) => node.props["data-nav"] === key), key);
  }
});

test("Codex 页面与概览保留顶部启动 / 重启按钮", () => {
  const { context } = harness();
  assert.equal(context.codexLaunchVisible("userScripts", "codex", "codex"), true);
  assert.equal(context.codexLaunchVisible("enhance", "codex"), true);
  assert.equal(context.codexLaunchVisible("overview", "codex"), true);
  assert.match(text, /onRestart: \(\) => void actions\.restart\(\)/);
});

test("tools 限定的页面随侧栏 Agent 过滤，万物皆拓展除外", () => {
  const switchTool = declaration("switchTool").getText(app);
  assert.match(switchTool, /if \(!pageVisibleForTool\(currentRoute, toolId\)\)/);
  assert.match(switchTool, /if \(destination\) await navigate\(destination\);\s*else if \(globalNavigationRoutes\.includes\(route\)\) await navigate\("overview"\)/);
  assert.match(text, /if \(currentRoute\?\.tools && currentRoute\.id !== "userScripts" && !pageVisibleForTool\(currentRoute, "codex"\)\)/);
  assert.match(declaration("routeCommand").getText(app), /if \(item\.tools && routeId !== "userScripts" && !pageVisibleForTool\(item, "codex"\)\) return null/);
});

test("只有明确声明 Claude 适配的拓展才显示 Claude Code 宿主标签", () => {
  const row = functionSource("ScriptRow");
  assert.match(row, /pkg\?\.claudeDesktop \? \{ text: "Claude Code" \} : null/);
});

function extensionHarness() {
  const functionNames = ["UserScriptsScreen", "ExtensionsHero", "ScriptRow", "localScriptStateLabel", "localizedPackageText"];
  const source = functionNames.map(functionSource).join("\n");
  const componentNames = [...source.matchAll(/<([A-Z]\w*)\b/g)].map((match) => match[1]);
  const states = new Map<string, unknown[]>();
  let currentFunction = "";
  let cursor = 0;
  const calls: Array<[string, ...unknown[]]> = [];
  const context = vm.createContext({
    ...Object.fromEntries([...icons, ...componentNames].map((name) => [name, name])),
    React: {
      Fragment: "Fragment",
      createElement: (type: Element["type"], props: object | null, ...children: unknown[]) => ({ type, props: { ...props, children } }),
    },
    t: (value: string) => value,
    tf: (value: string, args: unknown[]) => value.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
    getLanguage: () => "zh",
    useState: (initial: unknown) => {
      const values = states.get(currentFunction) ?? [];
      states.set(currentFunction, values);
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next: unknown) => {
        values[index] = typeof next === "function" ? next(values[index]) : next;
      }];
    },
    useMemo: (compute: () => unknown) => compute(),
    // 打开页面时市场还没读过就自动读一次：记下调用，渲染时不执行副作用。
    useEffect: () => undefined,
    agentVisible, extensionEnabledForHost, extensionHostForTool, extensionsForHost, extensionStateForHost,
    defaultMarketSort, parseMarketTime, sortMarketScripts,
    formatMarketUpdatedAt: (value: string) => value,
  });
  vm.runInContext(transpile(`const ${declaration("extensionCapabilities").getText(app)};\n${source}`), context);
  const actions = new Proxy({}, {
    get: (_target, action: string) => (...args: unknown[]) => {
      calls.push([action, ...args]);
      return Promise.resolve();
    },
  });
  const render = (name: string, props: object) => {
    currentFunction = name;
    cursor = 0;
    return context[name](props) as Element;
  };
  return { context, actions, calls, render };
}

function extensionScript(key: string, enabled: boolean, claudeEnabled: boolean, claude = true) {
  return {
    key, name: key, source: "user", kind: "package", enabled, claude_enabled: claudeEnabled,
    status: "loaded", error: "",
    package: {
      id: key, version: "1.0.0", description: "", engine: 1, routes: [],
      ...(claude ? { claudeDesktop: { tools: [] } } : {}),
    },
  };
}

function extensionScreenProps(h: ReturnType<typeof extensionHarness>, host: ExtensionHost = "codex") {
  return {
    host,
    onOpenBuiltins: () => h.calls.push(["openBuiltins"]),
    actions: h.actions,
    settings: {
      user_scripts: {
        enabled: false,
        claude_enabled: true,
        skip_next_start: true,
        scripts: [
          extensionScript("user:codex", true, false, false),
          extensionScript("user:claude-off", true, false),
          extensionScript("user:claude-on", false, true),
        ],
        builtins: [{ id: "codex-builtin", enabled: true }],
      },
    },
    market: {
      market: {
        scripts: [{ id: "market-codex", name: "Codex script", tags: [], installed: false }],
        packages: [{ id: "curated-codex" }],
      },
    },
  };
}

test("万物皆拓展固定绑定 Codex 宿主，不显示 Claude 宿主切换按钮", () => {
  assert.match(text, /<UserScriptsScreen host="codex"/);
  const h = extensionHarness();
  const props = extensionScreenProps(h, "codex");
  const hero = elements(h.render("UserScriptsScreen", props)).find((node) => node.type === h.context.ExtensionsHero);
  assert.ok(hero);
  const controls = elements(h.render("ExtensionsHero", hero.props)).filter((node) => node.type === "button");
  assert.equal(controls.length, 0);
});

test("万物皆拓展保留社区 / 本地 / 我发布的，已去掉精选包与 DSH 插件", () => {
  const h = extensionHarness();
  const props = extensionScreenProps(h, "codex");
  let nodes = elements(h.render("UserScriptsScreen", props));
  assert.doesNotMatch(text, /<CuratedPackagesSection\b|<DshPluginsPanel\b/);
  assert.ok(nodes.some((node) => node.type === "ExtensionCreatorCard"));
  assert.ok(nodes.some((node) => node.type === "CommunityExtensionsPanel"));
  const skip = nodes.find((node) => node.type === "MenuItem" && elementText(node) === "下次启动跳过拓展");
  assert.ok(skip);
  assert.equal(skip.props.checked, true);
  assert.ok(nodes.some((node) => node.type === "button" && elementText(node).includes("热重载拓展")));
  const filters = nodes.find((node) => node.type === "CxFilters");
  assert.ok(filters);
  assert.deepEqual(Array.from(filters.props.items, (item: { id: string }) => item.id), ["community", "local", "mine"]);
  assert.equal(filters.props.value, "community");
  filters.props.onChange("local");
  nodes = elements(h.render("UserScriptsScreen", props));
  assert.deepEqual(nodes.filter((node) => node.type === h.context.ScriptRow).map((node) => node.props.script.key), [
    "user:codex", "user:claude-off", "user:claude-on",
  ]);
  assert.ok(nodes.some((node) => node.type === "BuiltinExtensionsSummary"));
});

test("本地拓展整体开关读取并写入 codex 宿主，关闭时显示启用横幅", () => {
  const h = extensionHarness();
  const nodes = elements(h.render("UserScriptsScreen", extensionScreenProps(h, "codex")));
  const control = nodes.find((node) => node.type === "MenuItem" && elementText(node) === "启用本地拓展");
  assert.ok(control);
  assert.equal(control.props.checked, false);
  control.props.onClick();
  assert.deepEqual(h.calls, [["setUserScriptsEnabled", true, "codex"]]);
  const banner = nodes.find((node) => node.type === "CxBanner");
  assert.ok(banner);
  const enable = elements(banner.props.children).find((node) => node.type === "button");
  assert.ok(enable);
  enable.props.onClick();
  assert.deepEqual(h.calls.at(-1), ["setUserScriptsEnabled", true, "codex"]);
});

test("Claude 行不显示 Codex 加载失败，单项开关带 Claude 宿主", () => {
  const h = extensionHarness();
  const script = {
    ...extensionScript("user:both", false, true),
    status: "failed",
    error: "CODEX_ONLY_ERROR",
  };
  let nodes = elements(h.render("ScriptRow", { host: "claude", script, globalEnabled: true, actions: h.actions }));
  const control = nodes.find((node) => node.type === "input");
  assert.ok(control);
  assert.equal(control.props.checked, true);
  control.props.onChange();
  assert.deepEqual(h.calls, [["setUserScriptEnabled", script.key, false, "claude"]]);
  let state = nodes.find((node) => node.props.className === "user-script-state-label");
  assert.ok(state);
  assert.equal(state.props["data-state"], "notLoaded");
  assert.equal(elementText(state), "重启后应用");
  assert.doesNotMatch(String(state.props.title), /CODEX_ONLY_ERROR|Codex/);

  nodes = elements(h.render("ScriptRow", { host: "claude", script, globalEnabled: false, actions: h.actions }));
  state = nodes.find((node) => node.props.className === "user-script-state-label");
  assert.equal(state?.props["data-state"], "globalOff");
  assert.doesNotMatch(String(state?.props.title), /Codex/);
});

test("Codex 行保留加载失败详情和自己的单项开关", () => {
  const h = extensionHarness();
  const script = { ...extensionScript("user:both", true, false), status: "failed", error: "CODEX_ONLY_ERROR" };
  const nodes = elements(h.render("ScriptRow", { host: "codex", script, globalEnabled: true, actions: h.actions }));
  const control = nodes.find((node) => node.type === "input");
  assert.ok(control);
  assert.equal(control.props.checked, true);
  control.props.onChange();
  assert.deepEqual(h.calls, [["setUserScriptEnabled", script.key, false, "codex"]]);
  const state = nodes.find((node) => node.props.className === "user-script-state-label");
  assert.equal(state?.props["data-state"], "failed");
  assert.match(String(state?.props.title), /CODEX_ONLY_ERROR/);
});

type ActionResult = {
  status: string;
  settings: { revision: number; claudeAppExtensions: boolean; theme: string };
  user_scripts: { enabled: boolean; claude_enabled: boolean; scripts: Array<Record<string, unknown>> };
};

function extensionActionResult(enabled: boolean, status = "ok"): ActionResult {
  return {
    status,
    settings: { revision: 8, claudeAppExtensions: enabled, theme: "saved-theme" },
    user_scripts: {
      enabled: false,
      claude_enabled: enabled,
      scripts: [{ key: "user:both", enabled: false, claude_enabled: enabled, market_id: "installed", version: "1.0.0" }],
    },
  };
}

function extensionActionHarness(result: ActionResult | null, reloadStatus?: string) {
  const requests: Array<{ command: string; payload: Record<string, unknown> }> = [];
  const events: string[] = [];
  const draft = {
    revision: 7,
    claudeAppExtensions: false,
    theme: "unsaved-theme",
    customDraft: { keep: "unsaved provider settings" },
  };
  const originalMemo = { status: "ok", extensions: false, appPath: "/test/Claude.app", voiceInput: true };
  const memo: { status: typeof originalMemo | null } = { status: originalMemo };
  const state = {
    settings: null as ActionResult | null,
    form: draft,
    market: {
      market: { scripts: [{ id: "installed", version: "1.1.0", installed: false, installedVersion: "", updateAvailable: false }] },
      user_scripts: null as ActionResult["user_scripts"] | null,
    },
  };
  const context = vm.createContext({
    t: (value: string) => value,
    run: async (operation: () => Promise<unknown>) => operation(),
    call: async (command: string, payload: Record<string, unknown>) => {
      requests.push({ command, payload: structuredClone(payload) });
      return result;
    },
    setSettings: (next: ActionResult) => {
      events.push("settings");
      state.settings = next;
    },
    setScriptMarket: (update: (current: typeof state.market) => typeof state.market) => {
      events.push("market");
      state.market = update(state.market);
    },
    setSettingsForm: (update: (current: typeof draft) => typeof draft) => {
      events.push("form");
      state.form = update(state.form);
    },
    claudeLocalizationMemo: memo,
    reloadUserScripts: async () => { events.push("reload"); return reloadStatus; },
    refreshUserScriptInventory: async () => { events.push("refresh"); },
    showResultNotice: () => { events.push("notice"); },
  });
  const actionNames = ["setUserScriptsEnabled", "setUserScriptEnabled"];
  vm.runInContext(transpile([
    functionSource("isSuccessStatus"),
    functionSource("syncMarketInstalledState"),
    ...actionNames.map((name) => `const ${declaration(name).getText(app)}; globalThis.${name} = ${name};`),
  ].join("\n")), context);
  return { context, requests, events, state, draft, memo, originalMemo };
}

test("Codex 保存动作默认省略 host 参数并保留热重载", async () => {
  for (const host of [undefined, "codex"] as const) {
    const h = extensionActionHarness(extensionActionResult(true));
    await h.context.setUserScriptsEnabled(true, host);
    assert.deepEqual(h.requests, [{ command: "set_user_scripts_enabled", payload: { enabled: true } }]);
    assert.ok(h.events.includes("reload"));
    assert.equal(h.state.form, h.draft);
    assert.equal(h.memo.status, h.originalMemo);

    const row = extensionActionHarness(extensionActionResult(false));
    await row.context.setUserScriptEnabled("user:both", false, host);
    assert.deepEqual(row.requests, [{ command: "set_user_script_enabled", payload: { key: "user:both", enabled: false } }]);
    assert.ok(row.events.includes("reload"));
    assert.ok(row.events.includes("refresh"));
    assert.equal(row.state.form, row.draft);
    assert.equal(row.memo.status, row.originalMemo);
  }
});

test("Codex 单项开关在热重载待确认时不立即覆盖运行状态", async () => {
  for (const reloadStatus of ["ok", "failed", "warning"]) {
    const h = extensionActionHarness(extensionActionResult(false), reloadStatus);
    await h.context.setUserScriptEnabled("user:both", false, "codex");
    assert.ok(h.events.includes("reload"));
    assert.equal(h.events.includes("refresh"), reloadStatus !== "warning");
  }
});

test("Claude 总开关传递 host 并只同步相关设置字段及补丁版缓存", async () => {
  for (const enabled of [true, false]) {
    const result = extensionActionResult(enabled);
    const h = extensionActionHarness(result);
    h.draft.claudeAppExtensions = !enabled;
    h.originalMemo.extensions = !enabled;
    await h.context.setUserScriptsEnabled(enabled, "claude");
    assert.deepEqual(h.requests, [{
      command: "set_user_scripts_enabled",
      payload: { enabled, host: "claude" },
    }]);
    assert.equal(h.events.includes("reload"), false);
    assert.equal(h.state.settings, result);
    assert.equal(h.state.market.user_scripts, result.user_scripts);
    assert.deepEqual(structuredClone(h.state.market.market.scripts[0]), {
      id: "installed", version: "1.1.0", installed: true, installedVersion: "1.0.0", updateAvailable: true,
    });
    assert.equal(h.state.form.revision, result.settings.revision);
    assert.equal(h.state.form.claudeAppExtensions, enabled);
    assert.equal(h.state.form.theme, "unsaved-theme");
    assert.equal(h.state.form.customDraft, h.draft.customDraft);
    assert.equal(h.draft.revision, 7, "不得原地覆盖原始表单草稿");
    assert.equal(h.draft.claudeAppExtensions, !enabled);
    assert.deepEqual(structuredClone(h.memo.status), { ...h.originalMemo, extensions: enabled });
    assert.equal(h.originalMemo.extensions, !enabled, "缓存更新也保留原对象");
    assert.ok(h.events.includes("notice"));
  }
});

test("Claude 单项保存传递 host，刷新库存但不热重载 Codex", async () => {
  const result = extensionActionResult(true);
  const h = extensionActionHarness(result);
  await h.context.setUserScriptEnabled("user:both", true, "claude");
  assert.deepEqual(h.requests, [{
    command: "set_user_script_enabled",
    payload: { key: "user:both", enabled: true, host: "claude" },
  }]);
  assert.equal(h.state.settings, result);
  assert.equal(h.state.market.user_scripts, result.user_scripts);
  assert.equal(h.events.includes("reload"), false);
  assert.ok(h.events.includes("refresh"));
  assert.ok(h.events.includes("notice"));
  assert.equal(h.state.form, h.draft, "单项开关不覆盖设置页草稿");
  assert.equal(h.memo.status, h.originalMemo, "单项开关不改宿主总开关缓存");
});

test("Claude 保存失败或请求无结果时不写入成功状态", async () => {
  const failed = extensionActionHarness(extensionActionResult(true, "failed"));
  await failed.context.setUserScriptsEnabled(true, "claude");
  assert.equal(failed.state.form, failed.draft);
  assert.equal(failed.memo.status, failed.originalMemo);
  assert.equal(failed.events.includes("reload"), false);
  assert.ok(failed.events.includes("notice"));

  const missing = extensionActionHarness(null);
  await missing.context.setUserScriptsEnabled(true, "claude");
  await missing.context.setUserScriptEnabled("user:both", true, "claude");
  assert.deepEqual(missing.events, []);

  const noCachedStatus = extensionActionHarness(extensionActionResult(true));
  noCachedStatus.memo.status = null;
  await noCachedStatus.context.setUserScriptsEnabled(true, "claude");
  assert.equal(noCachedStatus.memo.status, null);
  assert.equal(noCachedStatus.state.form.claudeAppExtensions, true);
});

test("后台设置变更事件同步 Claude 和 Computer Use 字段及 revision，保留其它草稿", async () => {
  const effects: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect") {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback)) {
        let listens = false;
        const findListener = (candidate: ts.Node) => {
          if (ts.isCallExpression(candidate)
            && ts.isPropertyAccessExpression(candidate.expression)
            && candidate.expression.name.text === "addEventListener"
            && candidate.arguments[0]
            && ts.isIdentifier(candidate.arguments[0])
            && candidate.arguments[0].text === "BACKEND_SETTINGS_CHANGED_EVENT") listens = true;
          ts.forEachChild(candidate, findListener);
        };
        findListener(callback);
        if (listens) effects.push(callback);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  assert.equal(effects.length, 1);

  const changed = {
    computerUseMode: "remote",
    computerUseApproval: "always",
    computerUsePip: true,
    claudeAppVoiceInput: true,
    claudeAppLocalization: true,
    claudeAppExtensions: true,
    claudeAppComputerUse: true,
    claudeAppBashTimeout: 900000,
    claudeDesktopLocal: { enabled: true, model: "claude-test", localization: true, voiceInput: true, computerUse: false, backgroundMode: false },
    // #2937：记下使用模式也由后端单独写入，表单要跟上，否则下一次整份保存会写回旧值。
    managerAgentFocus: "enhance",
    nativeAuthSelection: { mode: "account", accountRef: "fixture-b" },
  };
  const draft = {
    revision: 3,
    computerUseMode: "local",
    computerUseApproval: "never",
    computerUsePip: false,
    claudeAppVoiceInput: false,
    claudeAppLocalization: false,
    claudeAppExtensions: false,
    claudeAppComputerUse: false,
    claudeAppBashTimeout: 60000,
    claudeDesktopLocal: { enabled: false, model: "", localization: true, voiceInput: false, computerUse: false, backgroundMode: false },
    managerAgentFocus: "",
    nativeAuthSelection: { mode: "account", accountRef: "fixture-a" },
    theme: "unsaved-theme",
    providerDraft: { model: "unsaved-model" },
  };
  const originalDraft = structuredClone(draft);
  const result = {
    status: "ok",
    settings: { ...changed, revision: 4, theme: "saved-theme", providerDraft: { model: "saved-model" } },
  };
  const eventName = "codex-plus:backend-settings-changed";
  const listeners = new Map<string, () => void>();
  const requests: string[] = [];
  const updates: Array<typeof result> = [];
  let form = draft;
  const context = vm.createContext({
    BACKEND_SETTINGS_CHANGED_EVENT: eventName,
    window: {
      addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
      removeEventListener: (name: string, handler: () => void) => {
        assert.equal(listeners.get(name), handler);
        listeners.delete(name);
      },
    },
    run: async (operation: () => Promise<unknown>) => operation(),
    call: async (command: string) => {
      requests.push(command);
      return result;
    },
    normalizeSettings: (settings: object) => settings,
    setSettings: (value: typeof result) => updates.push(value),
    setSettingsForm: (update: (current: typeof draft) => typeof draft) => { form = update(form); },
  });
  vm.runInContext(transpile(`globalThis.mount = ${effects[0].getText(app)};`), context);
  const cleanup = context.mount() as () => void;
  assert.deepEqual(Array.from(listeners.keys()), [eventName]);
  listeners.get(eventName)!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ["load_settings"]);
  assert.deepEqual(updates, [result]);
  assert.deepEqual(structuredClone(form), { ...originalDraft, ...changed, revision: 4 });
  assert.equal(form.providerDraft, draft.providerDraft);
  assert.deepEqual(draft, originalDraft);
  cleanup();
  assert.equal(listeners.size, 0);
});
