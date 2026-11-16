import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const app = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function functionSource(name: string) {
  const declaration = app.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `${name} should exist`);
  return declaration.getText(app);
}

test("整体设置只放应用级选项，Agent 设置承担工具级选项", () => {
  const global = functionSource("GlobalSettingsScreen");
  const agent = functionSource("AgentSettingsScreen");

  for (const copy of ["界面主题", "配置备份与迁移", "配置文件路径"]) {
    assert.ok(global.includes(`t("${copy}")`), `整体设置应包含 ${copy}`);
  }
  assert.doesNotMatch(global, /Codex 供应商设置|Codex 启动参数/);
  for (const action of ["actions.setThemePreference", "actions.exportSettings", "actions.importSettings"]) {
    assert.ok(global.includes(action), `整体设置应保留 ${action}`);
    assert.ok(!agent.includes(action), `Agent 设置不应包含 ${action}`);
  }

  for (const copy of ["Codex 启动参数"]) {
    assert.ok(agent.includes(`t("${copy}")`), `Agent 设置应包含 ${copy}`);
  }
  // 测试模型已删除：「测试供应商」直接用供应商自己的默认模型。
  assert.doesNotMatch(agent, /供应商测试模型|relayTestModel/);
});

test("Codex 设置与整体设置都进齿轮的设置模式，不占 Agent 的页签", () => {
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const globalNavigationRoutes"));
  assert.doesNotMatch(sections, /"agentSettings"/);
  assert.match(text, /const settingsModeRoutes = new Set<Route>\(\["settings", "about", "agentSettings", "maintenance",/);

  const globalNavigation = text.slice(text.indexOf("const globalNavigationRoutes"), text.indexOf("const defaultSettings"));
  assert.match(globalNavigation, /"settings"/);
  assert.doesNotMatch(globalNavigation, /"agentSettings"/);
});

test("设置菜单只属于 Codex，Claude / Grok 不再显示只有跳转按钮的空设置页", () => {
  assert.match(text, /\{ id: "agentSettings",[^\n]*tool: "codex" \}/);
  const agent = functionSource("AgentSettingsScreen");
  assert.doesNotMatch(agent, /没有独立设置项|前往 Grok 配置|前往 Claude 增强/);
});

test("多 Agent Beta 页面（Computer Use / Agent 协作）与网关设置已从导航与设置菜单剥离", () => {
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const globalNavigationRoutes"));
  assert.doesNotMatch(sections, /"computerUse"|"agentCollaboration"/);

  const globalNavigation = text.slice(text.indexOf("const globalNavigationRoutes"), text.indexOf("const defaultSettings"));
  assert.doesNotMatch(globalNavigation.slice(0, globalNavigation.indexOf("\n")), /"computerUse"|"agentCollaboration"/);
  assert.match(globalNavigation, /const toolNavigationRoutes: Route\[\] = \["agentCache"\];/);
  assert.match(globalNavigation, /const gatewayNavigationRoutes: Route\[\] = \[\];/);
  const entries = text.slice(text.indexOf("function settingsNavEntries"), text.indexOf("const settingsModeRoutes"));
  assert.doesNotMatch(entries, /"computerUse"|"agentCollaboration"|"doctor"|"update"|"gateway"/);
  assert.match(entries, /entries\.filter\(\(entry\) => routeVisible\(focus, entry\.route\)/);
});

test("标题：设置模式用分类名，Agent 自己的页面和其余页面都用页面名", () => {
  const entry = functionSource("App");
  assert.match(entry, /settingsEntryKey\r?\n\s*\? settingsEntries\.find\(\(entry\) => entry\.key === settingsEntryKey\)\?\.label/);
  assert.match(entry, /onAgentPage\r?\n\s*\? routeTitle\(route\)/);
  assert.match(entry, /<h1 title=\{[^\n]*\}>\{pageTitle\}<\/h1>/);
  assert.match(entry, /const activeToolName = toolEntries\.find/);
});

test("精简版仅管理 Codex：providerRoutes 仅保留 Codex 连接与多开，侧栏无网关分组或模式问卷", () => {
  const helpers = text.slice(text.indexOf("const multiAgentRoutes"), text.indexOf("function agentFocusDescription"));
  assert.match(helpers, /const providerRoutes = new Set<Route>\(\["relay", "relayEnvironment", "multiLaunch"\]\);/);
  assert.match(helpers, /providersHidden\(focus\) && providerRoutes\.has\(routeId\)/);
  const sidebar = functionSource("AppSidebar");
  assert.doesNotMatch(sidebar, /shownGateway|gatewayEntries|<AgentFocusDialog|Agent 增强/);
  assert.match(sidebar, /\.filter\(\(item\) => routeVisible\(focus, item\.route\)\)/);
  assert.match(text, /if \(!item \|\| !routeVisible\(agentFocus, routeId\)\) return null;/);
  assert.match(text, /if \(!routeVisible\(agentFocus, route\)\) \{[\s\S]{0,80}void navigate\("overview"\);/);
});
