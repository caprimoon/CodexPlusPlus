/** 外壳布局：一条侧栏（网关 / Agent / 工具），⌘K 面板，右下角提示卡。直接扫源码，防止结构被无意改回。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// 源码契约与 checkout 行尾无关，统一后仍保留全部结构与空白断言。
function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const text = readSource("./App.tsx");
const styles = readSource("./styles.css");
const app = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function functionSource(name: string) {
  const declaration = app.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `${name} should exist`);
  return declaration.getText(app);
}

test("只保留一条侧栏，旧的图标栏和 Agent 子侧栏都已移除", () => {
  assert.doesNotMatch(text, /function ApplicationRail|function ToolSwitcher|className="sidebar"|className="app-rail"/);
  assert.match(functionSource("App"), /<AppSidebar\b/);
  assert.match(styles, /\.shell \{\n  grid-template-columns: 220px minmax\(0, 1fr\);/);
  assert.doesNotMatch(styles, /\.app-rail\b|\.tool-chip\b|\.rail-brand\b/);
});

test("精简版侧栏无网关/首页卡片，仅保留 Codex 并支持记忆页签；Agent 播放键与设置模式保持精简", () => {
  const sidebar = functionSource("AppSidebar");
  assert.doesNotMatch(sidebar, /useGatewayPayload|data-tour="hub"|shownGateway|pendingUpdateVersion/);
  assert.match(text, /const agentHomeRoute: Record<string, Route> = \{ codex: "overview" \}/);
  assert.match(text, /const agentEntryRoute = \(toolId: ToolId\) => agentTarget\(agentRoutes\(toolId\), lastAgentRoute\.get\(toolId\), agentHomeRoute\[toolId\] \?\? "overview"\)/);
  assert.match(functionSource("App"), /onOpenAgent=\{\(toolId, destination\) => void switchTool\(toolId, destination \?\? agentEntryRoute\(toolId\)\)\}/);
  assert.match(functionSource("App"), /if \(!globalNavigationRoutes\.includes\(route\)\) lastAgentRoute\.set\(activeTool, route\);/);
});

test("侧栏改为统一扁平导航分组 + 底部 Codex 状态控制条，不再套「Agent 增强 → Codex」折叠子菜单", () => {
  const sidebar = functionSource("AppSidebar");
  assert.doesNotMatch(sidebar, /Agent 增强|cx-side-subnav|collapsedAgent|Agent 页面/);
  assert.match(sidebar, /const workspaceEntries: SideEntry\[\] = \[/);
  assert.match(sidebar, /const enhancementEntries: SideEntry\[\] = \[/);
  assert.match(sidebar, /className="cx-side-codex-dock"/);
  assert.match(sidebar, /data-tour="agents"/);
  assert.match(sidebar, /onClick=\{\(\) => onOpenAgent\("codex", "overview"\)\}/);
  assert.match(sidebar, /const statusTone = unattached \? "warn" : codexRun\.running \? "ok" : codexRun\.unavailableReason \? "muted" : "direct";/);
  assert.match(sidebar, /const runButtonLabel = unattached \? t\("重启并挂载"\) : codexRun\.running \? t\("停止 Codex"\) : t\("启动 Codex"\);/);
  assert.match(sidebar, /aria-label=\{runButtonLabel\}/);
  assert.match(sidebar, /onClick=\{unattached \? codexRun\.onRestart : codexRun\.running \? codexRun\.onStop : codexRun\.onStart\}/);
  assert.doesNotMatch(sidebar, /tool\.id === "claude"|claudeRun/);
  assert.match(text, /const stoppedByUser = result\.latest_launch\?\.phase === "user_stopped";/);
  const lib = readSource("../src-tauri/src/lib.rs");
  assert.match(lib, /commands::stop_codex_plus,/);
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const globalNavigationRoutes"));
  assert.match(sections, /\{ id: "overview", routes: \["overview", "relay"\] \}/);
  for (const id of ["overview", "enhance"]) assert.match(sections, new RegExp(`id: "${id}"`));
  assert.doesNotMatch(sections, /"agentSettings"|"relayEnvironment"|"claude"|"claudePatch"/);
  assert.match(text, /const settingsModeRoutes = new Set<Route>\(\["settings", "about", "agentSettings", "maintenance", "agentCache"\]\);/);
  assert.doesNotMatch(text, /key: "codexConnection"|key: "legacyProxy"|key: "legacyRelay"/);
  assert.match(text, /id: "relay", get label\(\) \{ return t\("连接与供应商"\); \}/);
  assert.doesNotMatch(functionSource("App"), /<AgentPageTabs\b/);
});

test("⌘K 打开命令面板，已移除 hub / gateway 页面渲染", () => {
  const entry = functionSource("App");
  assert.match(entry, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(entry, /<CommandPalette commands=\{paletteCommands\}/);
  assert.doesNotMatch(entry, /<HubOverview\b|<GatewayPage\b/);
});

test("启动 Codex 一眼可见：Codex 页面顶栏最右侧主按钮与侧栏播放键都复用 launch / restart（#2744 / #2745）", () => {
  const entry = functionSource("App");
  const button = readSource("./CodexLaunchButton.tsx");
  assert.match(entry, /const codexLaunch: CodexLaunchState = \{\n\s*running: codexAppRunning,\n\s*busy: launchPending,/);
  assert.match(entry, /overview\?\.codex_app\?\.status === "missing"\n\s*\? t\("没有找到 Codex 应用，请先安装 Codex"\)/);
  assert.match(entry, /onLaunch: \(\) => void actions\.launch\(\),\n\s*onRestart: \(\) => void actions\.restart\(\),/);
  assert.match(entry, /label: codexAppRunning \? t\("重启 Codex"\) : t\("启动 Codex"\)/);
  assert.match(button, /const label = state\.busy \? t\("处理中…"\) : state\.running \? t\("重启 Codex"\) : t\("启动 Codex"\);/);
  assert.match(button, /onClick=\{state\.running \? state\.onRestart : state\.onLaunch\}/);
  assert.match(button, /disabled=\{state\.busy \|\| unavailable\}/);
  assert.match(button, /<span className=\{`codex-launch \$\{className\}`\.trim\(\)\} data-running=\{state\.running\} data-unavailable=\{unavailable\} title=\{hint\}>/);
  assert.match(button, /variant="default"/);
  assert.match(entry, /const onCodexPage = routeTool\(route\) === "codex" \|\| route === "overview";/);
  assert.match(
    entry,
    /<div className="topbar-page-actions" data-topbar-actions \/>\n[\s\S]{0,400}\{onCodexPage \? <CodexLaunchButton className="topbar-codex-launch" size="sm" state=\{codexLaunch\} \/> : null\}/,
  );
  assert.equal(entry.match(/<CodexLaunchButton\b/g)?.length, 1, "启动按钮只在顶栏出现一次");
  const codexRoutes = text.slice(text.indexOf("const routes: Array"), text.indexOf("const navigationSections")).split("\n")
    .filter((line) => line.includes('tool: "codex"')).map((line) => /id: "(\w+)"/.exec(line)?.[1]);
  for (const id of ["relay", "multiLaunch", "enhance", "dreamSkin", "userScripts", "pluginMarket", "weixin", "agentSettings"]) {
    assert.ok(codexRoutes.includes(id), `${id} 属于 Codex，顶栏要显示启动按钮`);
  }
  const sidebar = functionSource("AppSidebar");
  assert.match(sidebar, /className="cx-side-codex-dock"/);
  assert.match(sidebar, /disabled=\{codexRun\.busy \|\| \(!codexRun\.running && Boolean\(codexRun\.unavailableReason\)\)\}/);
  assert.match(entry, /const codexRun = \{\n\s*running: codexAppRunning,\n\s*unattached: Boolean\(overview\?\.runtime_health\?\.codex_unattached\),\n\s*busy: launchPending,\n\s*unavailableReason: codexLaunch\.unavailableReason,\n\s*onStart: codexLaunch\.onLaunch,/);
  assert.match(entry, /codexRun=\{codexRun\}/);
  assert.match(styles, /\.shell \.side-agent-run \{\n(?:  [^\n]*\n)*  width: 24px;\n  height: 24px;/);
  assert.match(styles, /\.shell \.side-agent-run\[data-running="false"\] \{\n  background: hsl\(var\(--status-success\) \/ 0\.14\);\n  color: hsl\(var\(--status-success\)\);/);
  assert.doesNotMatch(styles, /:hover \.side-agent-run|\.side-agent-run \{[^}]*(?:opacity: 0;|visibility: hidden)/);
  assert.doesNotMatch(styles, /:has\(\.side-agent-run\)/);
  assert.match(styles, /\.shell \.side-agent-wrap\.has-run \.side-item-label \{/);
});

test("提示卡按语气分色、悬停暂停、不显示进度条，失败可复制详情", () => {
  const notice = functionSource("NoticeDialog");
  assert.match(notice, /noticeTone\(notice\.status\)/);
  assert.match(notice, /onMouseEnter=\{\(\) => setPaused\(true\)\}/);
  assert.match(notice, /tone === "error" && notice\.message/);
  assert.doesNotMatch(notice, /toast-progress/);
  assert.doesNotMatch(styles, /\.toast-progress\b|@keyframes toast-progress/);
});

test("Claude / Grok 等其他 Agent 入口与页面均已从主界面移除", () => {
  assert.doesNotMatch(text, /id: "claudeRelay"|id: "grok", get label|<ClaudeLocalizationScreen\b|<ClaudeProviderPage\b|function GrokScreen/);
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const globalNavigationRoutes"));
  assert.doesNotMatch(sections, /"claude"|"claudePatch"|"claudeRelay"|"grok"/);
});

test("页面不再画第二条标题栏：PageHeader 和工具页的操作都送进外壳顶栏", () => {
  const management = readSource("./ManagementPages.tsx");
  const extra = readSource("./ManagementExtra.tsx");
  const cache = readSource("./agent-cache.tsx");
  assert.match(management, /export function PageHeader\([^)]*\) \{\n  return <TopbarActions>\{actions\}<\/TopbarActions>;/);
  assert.match(extra, /function Header\([^)]*\) \{ return <TopbarActions>\{actions\}<\/TopbarActions>; \}/);
  for (const source of [management, extra]) assert.doesNotMatch(source, /className="mg-header"/);
  assert.match(cache, /<TopbarActions>/);
  assert.doesNotMatch(cache, /CardHeader|className="panel agent-cache-panel"/);
  // 顶栏里给页面操作留了单独的挂载点，排在「启动 / 重启 Codex」按钮左边。
  assert.match(text, /<div className="topbar-page-actions" data-topbar-actions \/>/);
});

test("紧凑密度层：管理页不再套外框，覆盖规则带 .shell 前缀不依赖加载顺序", () => {
  const layer = styles.slice(styles.indexOf("/* ── Graphite · 紧凑密度"));
  assert.match(layer, /\.shell \.mg-page \{\n  margin: 0 auto;\n  overflow: visible;\n  border: 0;/);
  assert.match(layer, /\.shell \.topbar \{\n  min-height: 44px;/);
  // 层内每条规则都以 .shell 开头
  const selectors = [...layer.matchAll(/^([^\s/@}][^{]*)\{$/gm)].map((match) => match[1]);
  assert.ok(selectors.length > 20);
  for (const selector of selectors) assert.match(selector, /^\.shell /, selector);
});

test("扁平侧栏按核心工作区（概览、连接与供应商、MCP 与 Skills、会话）与「拓展与增强」分组，无网关入口", () => {
  assert.match(text, /id: "userScripts", get label\(\) \{ return t\("外部拓展"\); \}/);
  assert.match(text, /const managementNavigationRoutes: Route\[\] = \["userScripts", "sessions", "context", "skills"\]/);
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const globalNavigationRoutes"));
  assert.doesNotMatch(sections, /"requestLog"|"sessions"|"context"|"skills"/);
  const sidebar = functionSource("AppSidebar");
  assert.match(sidebar, /routeEntry\("overview"\)/);
  assert.match(sidebar, /routeEntry\("userScripts", \{ key: "extensions", icon: Blocks, tour: "management" \}\)/);
  assert.ok(sidebar.indexOf('routeEntry("overview")') < sidebar.indexOf('key: "customize"'), "工作区分组排在拓展与增强之前");
  assert.match(sidebar, /match: customizeRoutes/);
  assert.doesNotMatch(sidebar, /"聚合网关"|gatewayEntries|Agent 增强/);
  assert.match(text, /const customizeRoutes: Route\[\] = \["context", "skills"\];/);
  assert.doesNotMatch(text, /"gatewaySessions"/);
  const entry = functionSource("App");
  assert.match(entry, /const shownSessionTab: SessionTab = "codex";/);
  assert.doesNotMatch(entry, /<SessionAgentTabs|<SessionsView/);
  assert.match(entry, /route === "sessions" \? \(\s*<ProjectSessionPage/);
});

test("请求日志功能已剥离主界面", () => {
  const entry = functionSource("App");
  assert.doesNotMatch(entry, /<RequestLogScreen\b|onOpenRequestLog/);
});

test("「连接与供应商」直接管理直连供应商并保留高级选项，去掉网关连接提示与供应商池导入按钮", () => {
  const app = functionSource("App");
  assert.doesNotMatch(app, /<LegacyRelayGatewayHint|<AgentDisconnectDialog|disable_gateway_binding/);
  assert.match(app, /\{route === "relay" \|\| route === "relayEnvironment" \? \(\n\s*<RelayScreen/);
  assert.match(app, /advanced=\{\(\n\s*<ProxySettingsScreen/);
  assert.match(app, /advancedOpen=\{route === "relayEnvironment" \|\| relayAdvancedOpen\}/);
  const card = functionSource("SortableRelayProfileCard");
  assert.doesNotMatch(card, /PoolLinkControl/);
  assert.match(card, /<Menu label=\{t\("供应商操作"\)\}>/);
  assert.match(card, /const deleteIssue = relayProfileDeleteIssue\(form, profile\.id\);/);
});

test("Skills 与 MCP 同一种行：每个 Skill 一行，右侧每个 Agent 一枚开关胶囊，不再有页面自己的配色和按钮尺寸", () => {
  const extra = readSource("./ManagementExtra.tsx");
  const css = readSource("./ManagementPages.css");
  assert.match(extra, /<CxRow className="cx-skill-row"/);
  assert.match(extra, /const agentColumns: McpAgentId\[\] = MCP_AGENTS\.filter\(\(agent\) => agentVisible\(focus, agent\)\);/);
  // 行里每个可见 Agent 一枚开关；分组标题同一列是这一组的批量开关。
  assert.match(extra, /agentColumns\.map\(\(agent\) => <AgentToggle /);
  assert.match(extra, /agentColumns\.map\(\(agent\) => <GroupAgentSelect /);
  assert.doesNotMatch(extra, /mg-agent-toggle|mg-skill-group-select/);
  assert.doesNotMatch(css, /\.dark \.mg-skills-page|\.mg-skills-page \.mg-primary|\.mg-skills-page :is\(\.mg-button/);
});

test("Agent 页签条不能是滚动容器：否则在 .screen 的 grid 里会被长页面挤成 1px，点进去就看不到页签", () => {
  const css = readSource("./ToolPages.css");
  const rules = [...css.matchAll(/\.agent-page-tabs\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(rules.length > 0);
  for (const body of rules) assert.doesNotMatch(body, /overflow/);
  assert.match(rules.join("\n"), /flex-wrap:\s*wrap/);
});

test("安装维护并进 Codex 设置：在设置模式的「Codex」分类里，设置页下方渲染维护内容，旧路由跳到设置", () => {
  const app = functionSource("App");
  assert.match(app, /const mapped: Route = target === "maintenance" \? "agentSettings" : target === "about" \? "settings" : target === "relayEnvironment" \? "relay" : target;/);
  assert.match(app, /\{route === "agentSettings" \|\| route === "maintenance" \? \(/);
  assert.match(text, /\{ key: "codex", label: "Codex", icon: AppWindow, route: "agentSettings", group: "agent"/);
  assert.doesNotMatch(app, /sections=\{codexSettingsSections\(\)\}/);
  const ids = [...text.slice(text.indexOf("function codexSettingsSections"), text.indexOf("const EXPERIMENTAL_TITLE")).matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["codex-settings-check", "codex-settings-startup", "codex-settings-takeover", "codex-settings-manual-launch"]);
  for (const id of ids) assert.match(text, new RegExp(`<CxSection(?:(?!<CxSection)[\\s\\S])*?\\bid="${id}"`));
  assert.match(app, /<MaintenanceScreen[\s\S]*?advanced=\{\(\n\s*<AgentSettingsScreen/);
  const maintenance = functionSource("MaintenanceScreen");
  assert.match(maintenance, /<CxSection id="codex-settings-manual-launch" title=\{t\("高级"\)\}>\n\s*<CxCard>\n\s*\{advanced\}/);
  assert.doesNotMatch(maintenance, /t\("当前识别"\)|t\("保存的应用路径"\)/);
  assert.match(maintenance, /actions\.chooseCodexAppPath\("folder"\)/);
  assert.match(maintenance, /actions\.clearCodexAppPath\(\)/);
});

test("页内目录收成单列：增强页的页签横排成胶囊、分组锚点不再显示；设置模式内容限宽", () => {
  for (const page of ["settings-page enhance-page sectioned-page cx-enhance-page", "settings-page codex-settings-page", "weixin-connect-page sectioned-page cx-page"]) {
    assert.ok(text.includes(`className="${page}"`), page);
  }
  const layer = readSource("./cursor-ui.css");
  assert.match(layer, /:root \.shell \.sectioned-page \{\n  display: flex;\n  flex-direction: column;/);
  assert.match(layer, /:root \.shell \.page-section-nav-list \{\n  display: none;/);
  assert.match(layer, /:root \.shell \.screen\[data-settings-mode="true"\] > \* \{\n  width: min\(100%, var\(--cx-content-narrow\)\);/);
  assert.match(text, /className="enhance-tabs tp-tabs cx-pills" role="tablist"/);
  // 「（实验）」和「需重启」从文字里拿出来做成标题旁的小标签。
  const toggle = functionSource("FeatureToggle");
  assert.match(toggle, /EXPERIMENTAL_TITLE\.test\(title\)/);
  assert.match(toggle, /RESTART_HINT\.test\(detail\)/);
});

test("插件市场紧凑布局的规则带 .shell 前缀：正式版 styles.css 后加载，同权重的 .panel { padding: 0 } 会清掉卡片内边距", () => {
  const css = readSource("./PluginMarketScreen.css");
  const block = css.slice(css.lastIndexOf("/*", css.indexOf("紧凑布局"))).replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...block.matchAll(/(?:^|\})\s*([^{}]+?)\s*\{/g)].map((match) => match[1].trim()).filter(Boolean);
  assert.ok(selectors.length > 10);
  for (const group of selectors) for (const selector of group.split(",")) assert.match(selector.trim(), /^\.shell /, selector);
  assert.match(block, /\.shell \.plugin-market-card \{[^}]*padding:\s*14px 16px/);
});

test("导入供应商弹窗：只有文字那块占满宽度，头像（也是 span）保持固定尺寸", () => {
  const css = readSource("./GatewayPage.css");
  assert.doesNotMatch(css, /\.gw-import-item > span \{/);
  assert.match(css, /\.gw-import-item > span:not\(\.gw-avatar\) \{[^}]*flex: 1/);
  assert.match(css, /\.gw-import-item > \.gw-avatar \{[^}]*flex: none/);
});

test("旧版代理设置直接显示在连接页「高级」折叠区里", () => {
  assert.match(text, /id: "relayEnvironment", get label\(\) \{ return t\("旧版代理设置"\); \}/);
  const legacy = functionSource("ProxySettingsScreen");
  assert.doesNotMatch(legacy, /helperMaxRequestBodyMib|protocolProxyAutoRetryMaxAttempts|takenOverByGateway/);
  assert.match(legacy, /t\("目录外模型映射（旧版）"\)/);
  assert.doesNotMatch(legacy, /本地服务与请求避震|onOpenGatewaySettings/);
  const env = functionSource("RelayEnvironmentScreen");
  assert.match(env, /const failed = result \? checks\.filter\(\(check\) => !check\.passed\) : \[\];/);
  assert.match(env, /\{failed\.map\(\(check\) => \(/);
});

test("首页、精选推荐与赞助商功能已完全移除", () => {
  const app = functionSource("App");
  assert.doesNotMatch(app, /<HomeScreen\b|refreshAds|featuredAds|sponsorHint/);
  const sidebar = functionSource("AppSidebar");
  assert.doesNotMatch(sidebar, /key: "home"/);
  assert.match(functionSource("loadInitialRoute"), /return "overview";/);
});

test("「连接与供应商」页仅保留直连与需协议转换供应商管理", () => {
  const screen = functionSource("RelayScreen");
  const earlyReturn = screen.indexOf("if (detailProfile) {");
  assert.ok(earlyReturn > 0);
  const after = screen.slice(earlyReturn);
  assert.doesNotMatch(after, /\n  (?:const|let) [^\n]*\buse[A-Z]\w*\(/, "提前返回之后不能再调用 hook");
  assert.doesNotMatch(screen, /PoolLinkControl|LegacyRelayGatewayHint|useCodexPoolLink|createNewAggregateProfile|cx-aggregate-note/);
  assert.match(screen, /onClick=\{\(\) => void saveRelaySettings\(\{ \.\.\.normalized, relayProfilesEnabled: true \}\)\}/);
  const header = screen.slice(screen.indexOf("<PageHeader"), screen.indexOf("<NativeAuthControl"));
  assert.match(header, /<div className="third-party-import" ref=\{thirdPartyImportTriggerRef\}>/);
  assert.match(screen, /Codex\+\+ 不会写入 Codex 的 config\.toml \/ auth\.json，直连供应商列表已隐藏。/);
});

test("多开页可以直接编辑、删除供应商：删除先查占用再二次确认，网关托管项不给入口（#2801）", () => {
  const screen = functionSource("CodexMultiLaunchScreen");
  // 编辑就地打开同一个供应商详情页，返回 / 保存后回到多开列表。
  assert.match(screen, /<RelayProfileDetail\r?\n\s+profile=\{detailProfile\}/);
  assert.match(screen, /onBack=\{\(\) => setDetailProfileId\(null\)\}/);
  assert.match(screen, /onClick=\{\(\) => setDetailProfileId\(profile\.id\)\}/);
  // 删除：先用旧版列表同一套占用检查，再提醒运行中的多开实例，最后危险确认。
  const remove = screen.slice(screen.indexOf("const deleteProfile"), screen.indexOf("if (detailProfile)"));
  const issue = remove.indexOf("relayProfileDeleteIssue(normalized, profile.id)");
  const confirm = remove.indexOf("appConfirm(message");
  const save = remove.indexOf("removeRelayProfile(normalized, profile.id)");
  assert.ok(issue > 0 && confirm > issue && save > confirm, "删除必须先查占用、再确认、最后保存");
  assert.match(remove, /runningInstancesForProfile\(actions\.multiLaunchInstances, profile\.id\)/);
  assert.match(remove, /danger: true/);
  assert.match(screen, /const gatewayManaged = profile\.id === CODEX_GATEWAY_RELAY_ID;/);
  // 编辑 / 删除收进行尾三点菜单；网关托管项没有菜单，整行也不可点。
  assert.match(screen, /\{gatewayManaged \? null : \(\r?\n\s+<Menu label=/);
  assert.match(screen, /onClick=\{gatewayManaged \? undefined : \(\) => setDetailProfileId\(profile\.id\)\}/);
  assert.match(screen, /disabled=\{normalized\.relayProfiles\.length <= 1\}/);
  // 使用中的供应商给出标记；导入入口指到旧版供应商页。
  assert.match(screen, /\{active \? <CxBadge>\{t\("使用中"\)\}<\/CxBadge> : null\}/);
  assert.match(screen, /onClick=\{onOpenRelay\}/);
  assert.match(functionSource("App"), /<CodexMultiLaunchScreen\r?\n\s+form=\{settingsForm\}\r?\n\s+relayFiles=\{relayFiles\}\r?\n\s+onOpenRelay=\{\(\) => void navigate\("relay"\)\}/);
  // 网关接管期间从多开进详情页，不能「设为当前」绕过断开并还原。
  assert.match(functionSource("RelayProfileDetail"), /isNew \|\| form\.activeRelayId === CODEX_GATEWAY_RELAY_ID \? null : \(/);
});

test("用量图表有鼠标交互：整列感应、高亮当天、浮出明细卡", () => {
  const usage = readSource("./GatewayUsage.tsx");
  assert.match(usage, /className="gw-bar-hit"/);
  assert.match(usage, /className="gw-chart-tip"/);
  const css = readSource("./GatewayPage.css");
  assert.match(css, /\.gw-chart\[data-hovering="true"\] \.gw-bar:not\(\[data-active="true"\]\)/);
  assert.match(css, /\.gw-usage-row:hover/);
});

test("Codex 概览保留直连供应商状态与切换下拉框，健康检查在仪表板下方", () => {
  const screen = functionSource("OverviewScreen");
  assert.match(screen, /<AgentDashboard\n\s*actions=\{codexActions\}\n\s*agent="codex"/);
  assert.doesNotMatch(screen, /useGatewayPayload|load_request_logs|codexStats/);
  assert.ok(screen.indexOf("overview-health-header") > screen.indexOf("<AgentDashboard"));
});

test("从 Codex 概览打开会话列表", () => {
  const dashboard = readSource("./AgentDashboard.tsx");
  assert.match(dashboard, /onOpenList\("sessions", agent\)/);
  assert.doesNotMatch(dashboard, /load_gateway_usage|load_request_logs|requestLog/);
});

test("「关于」并进「设置」：已剥离配置体检与版本与更新卡片，旧的 about 入口滚到关于分组", () => {
  const sidebar = functionSource("AppSidebar");
  assert.match(sidebar, /onClick=\{\(\) => openSettings\("settings", \["app-settings-general"\]\)\}/);
  const app = functionSource("App");
  assert.match(app, /settingsSections\.map\(\(id\) => `:not\(#\$\{id\}\)`\)/);
  assert.match(app, /if \(settingsFocus\) setSettingsSections\(settingsSectionsFor\(settingsFocus\)\);/);
  const entries = text.slice(text.indexOf("function settingsNavEntries"), text.indexOf("const settingsModeRoutes"));
  for (const id of ["app-settings-general", "app-settings-config", "app-settings-logs", "app-settings-diagnostics", "app-settings-about"]) {
    assert.ok(entries.includes(`"${id}"`), `${id} 要归到某个设置分类`);
  }
  assert.doesNotMatch(entries, /app-settings-doctor|app-settings-update/);
  assert.match(app, /if \(target === "about"\) setSettingsFocus\("app-settings-about"\);/);
  assert.ok(app.indexOf("<GlobalSettingsScreen") < app.indexOf("<AboutScreen"));
  const ids = [...text.slice(text.indexOf("function appSettingsSections"), text.indexOf("function AppSettingsFocus")).matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["app-settings-general", "app-settings-config", "app-settings-about", "app-settings-logs", "app-settings-diagnostics"]);
});

test("Computer Use 工作原理图与网关总览同一套三列拓扑", () => {
  const page = readSource("./ComputerUsePage.tsx");
  assert.match(page, /<HubTopology links=\{links\}>/);
  assert.match(page, /data-node="cu-core"/);
  assert.match(page, /data-node=\{`cu-client:\$\{id\}`\}/);
  const hub = readSource("./HubOverview.tsx");
  assert.match(hub, /export function HubTopology\(/);
});

test("首次导览可直接从通用设置重开，已移除模式问卷、入门清单与更新弹窗", () => {
  const app = functionSource("App");
  assert.doesNotMatch(app, /<AgentFocusDialog|<OnboardingSetup|<UpdateDialog/);
  assert.match(app, /\{tourOpen \? <OnboardingTour focus=\{agentFocus\} onClose=\{closeTour\} \/> : null\}/);
  assert.match(app, /window\.localStorage\.setItem\(TOUR_STORAGE_KEY, String\(TOUR_VERSION\)\)/);
  assert.match(functionSource("initialSetupOpen"), /return false;/);
  assert.match(app, /if \(tourOpen\) return;\s*setPaletteOpen/);
  assert.match(functionSource("GlobalSettingsScreen"), /onClick=\{onOpenTour\}/);
  const model = readSource("./onboarding-model.ts");
  const sidebar = functionSource("AppSidebar");
  for (const match of model.matchAll(/target: "([^"]+)"/g)) {
    const target = match[1];
    const anchored = target.startsWith("nav-") ? sidebar.includes(`tour: "${target}"`) : sidebar.includes(`data-tour="${target}"`) || sidebar.includes(`tour: "${target}"`);
    assert.ok(anchored, `引导目标 ${target} 在侧栏里没有锚点`);
  }
});

test("关于页与设置导航不再渲染更新区块与配置体检，并展示定制版本与 fork 仓库地址", () => {
  const about = functionSource("AboutScreen");
  assert.doesNotMatch(about, /app-settings-update|checkUpdate|performUpdate|BigPizzaV3\/CodexPlusPlus/);
  assert.match(about, /Codex\+\+（capriMoon精简基于\$\{baseVersion\}）/);
  assert.match(about, /github\.com\/caprimoon\/CodexPlusPlus/);
  assert.doesNotMatch(functionSource("GlobalSettingsScreen"), /<ConfigDoctorPanel\b|onOpenAgentFocus|使用模式/);
});

test("Computer Use 的页签与会话页等同一种下划线页签（tp-tabs），不再改写 mg-tabs", () => {
  const page = readSource("./ComputerUsePage.tsx");
  assert.match(page, /<div className="tp-tabs cu-tabs" role="tablist"/);
  const css = readSource("./ComputerUsePage.css");
  assert.doesNotMatch(css, /\.mg-tabs\.cu-tabs/);
});

test("供应商头像在任何列表里都不参与伸缩：挑选弹层、导入弹窗都出过被拉成横条的问题", () => {
  const css = readSource("./GatewayPage.css");
  assert.match(css, /span\.gw-avatar\[data-size\] \{\s*flex: none;/);
  assert.doesNotMatch(css, /\.gw-select-item span \{/);
});

test("OverviewScreen 与 AgentDashboard 只保留 Codex 状态与健康检查，移除网关统计与多 Agent 分支", () => {
  const overview = functionSource("OverviewScreen");
  assert.match(overview, /<AgentDashboard\n\s*actions=\{codexActions\}\n\s*agent="codex"/);
  assert.doesNotMatch(overview, /activeTool === "claude"|activeTool === "grok"/);
  const dashboard = readSource("./AgentDashboard.tsx");
  for (const command of ["list_local_sessions", "read_live_context_entries", "list_installed_skills"]) {
    assert.ok(dashboard.includes(`"${command}"`), command);
  }
  assert.doesNotMatch(dashboard, /load_gateway_usage|load_request_logs|open_agent_terminal/);
  const lib = readSource("../src-tauri/src/lib.rs");
  assert.match(lib, /agent_launch_commands::open_agent_terminal,/);
});

test("网关页的 Agent 图标：Claude Code / Grok 用遮罩按文字颜色绘制，不再把黑色单色图当 <img>", () => {
  for (const name of ["GatewayAgents.tsx", "TrayPanel.tsx", "GatewayPage.tsx"]) {
    const source = readSource(`./${name}`);
    assert.doesNotMatch(source, /src=\{agentIcon\(/, name);
  }
  const css = readSource("./GatewayPage.css");
  assert.match(css, /\.gw-agent-mono \{[^}]*mask: var\(--gw-agent-icon\)/);
});

test("内层滚动的页面（网关各页、Computer Use）滚动区延伸到窗口边，滚动条不压内容", () => {
  const css = readSource("./styles.css");
  assert.match(css, /\.shell :is\(\.gw-content, \.cu-content\) \{[^}]*width: calc\(100% \+ 20px\);[^}]*margin-right: -20px;[^}]*padding-right: 20px;/);
});

test("会话页可以删除会话，不再有「在终端继续」；Claude Code / Grok 走 delete_agent_session，Codex 走 delete_local_session", () => {
  const sessions = readSource("./GatewaySessions.tsx");
  assert.doesNotMatch(sessions, /在终端继续|resume_agent_session/);
  assert.match(sessions, /"delete_agent_session"/);
  assert.match(sessions, /"delete_local_session"/);
  assert.match(sessions, /appConfirm\(/);
  const lib = readSource("../src-tauri/src/lib.rs");
  assert.match(lib, /gateway_commands::delete_agent_session,/);
});

test("会话页列出 Claude Desktop 的会话：标出 Desktop / 已归档，恢复命令用 cliSessionId，删除前提示先退出 Desktop", () => {
  const sessions = readSource("./GatewaySessions.tsx");
  // Desktop / 已归档是行标题旁的小标签（CxRow 的 badges）。
  assert.match(sessions, /session\.surface === "desktop" \? <CxBadge title=\{t\("Claude Desktop 里的会话"\)\}>Desktop<\/CxBadge>/);
  assert.match(sessions, /session\.archived \? <CxBadge>\{t\("已归档"\)\}<\/CxBadge>/);
  assert.match(sessions, /const id = session\.resumeId \?\? session\.id;/);
  assert.match(sessions, /需要先退出 Claude Desktop/);
  const commands = readSource("../src-tauri/src/gateway_commands.rs");
  assert.match(commands, /sessions::list_claude_sessions_with_desktop\(/);
  assert.match(commands, /"claude" if desktop => \{\n\s*if codex_plus_core::computer_use::claude_desktop_running\(\)/);
});

test("添加供应商是弹出框，不再铺在供应商池页面里；池为空时显示引导", () => {
  const providers = readSource("./GatewayProviders.tsx");
  assert.match(providers, /className="gw-modal gw-catalog-modal"/);
  assert.match(providers, /\{catalogOpen \? \(\n\s*<ProviderCatalog/);
  assert.doesNotMatch(providers, /showCatalog/);
  assert.match(providers, /className="gw-card gw-pool-empty"/);
});

test("侧栏一级分组标题比子项醒目，快速跳转的快捷键按平台显示且弱化（#2778）", () => {
  assert.match(functionSource("AppSidebar"), /<kbd>\{paletteShortcut\}<\/kbd>/);
  assert.doesNotMatch(functionSource("AppSidebar"), /<kbd>⌘K<\/kbd>/);
  const label = styles.match(/\.side-group-label > button:first-child \{[^}]*\}/)?.[0] ?? "";
  const item = styles.match(/\n\.side-item \{[^}]*\}/)?.[0] ?? "";
  const size = (rule: string) => Number(rule.match(/font-size: ([\d.]+)px/)?.[1] ?? 0);
  assert.ok(size(item) > 0 && size(label) >= size(item), "分组标题字号不能比子项小");
  assert.match(label, /font-weight: 700/);
  assert.match(styles, /\.side-search kbd \{[^}]*font-size: 9\.5px/);
});

test("Codex 在它自己的窗口里退出后，侧栏 / 顶栏的运行状态能跟上（#2778）", () => {
  const entry = functionSource("App");
  assert.match(entry, /invoke<boolean \| null>\("codex_app_running"\)/);
  assert.match(entry, /if \(document\.visibilityState !== "visible"\) return;/);
  assert.match(entry, /running !== codexAppRunning\) void refreshOverview\(true\)/);
  assert.match(text, /const codexRunningPollMs = 5_000;/);
});

test("外部启动、没挂载增强脚本的 Codex：健康检查提示并给「重启并挂载」，侧栏停止按钮染色", () => {
  const health = functionSource("healthItems");
  assert.match(health, /overview\?\.runtime_health\?\.codex_unattached\n    \? \{/);
  assert.match(health, /status: "unattached",\n      ok: false,/);
  assert.match(health, /action: "restart" as const,/);
  const overview = functionSource("OverviewScreen");
  assert.match(overview, /item\.action === "restart" \? \(\n\s+<button className="cx-secondary" onClick=\{\(\) => void actions\.restart\(\)\}/);
  assert.match(functionSource("statusLabel"), /unattached: t\("未挂载"\)/);
  assert.match(functionSource("App"), /unattached: Boolean\(overview\?\.runtime_health\?\.codex_unattached\)/);
  assert.match(text, /const unattached = codexRun\.running && codexRun\.unattached;/);
  assert.match(text, /onClick=\{unattached \? codexRun\.onRestart : codexRun\.running \? codexRun\.onStop : codexRun\.onStart\}/);
  assert.match(text, /unattached \? <RotateCcw aria-hidden="true" \/>/);
  assert.match(readSource("./cursor-ui.css"), /\.cx-side-run\[data-unattached="true"\]:not\(:disabled\) \{\n  color: hsl\(var\(--status-warning\)\);/);
});

test("拓展是侧栏一级入口；除 Codex 外的工具从侧栏隐藏", () => {
  const sections = text.slice(text.indexOf("const navigationSections"), text.indexOf("const routeTool"));
  assert.doesNotMatch(sections, /"userScripts"/, "拓展不再出现在 Agent 页签里");
  assert.match(text, /const globalNavigationRoutes: Route\[\] = \[[^\]]*"userScripts"/);
  assert.match(text, /const hiddenSidebarTools = new Set<string>\(\["grok", "claude"\]\);/);
  assert.match(text, /setToolEntries\(\(result\.tools \?\? \[\]\)\.filter\(\(tool\) => tool\.id === "codex"\)\);/);
  assert.match(text, /setActiveTool\("codex"\);/);
});

test("供应商详情页不再 absolute 盖住吸顶标题：打开时 .screen 改纵向 flex 不滚动（#2888）", () => {
  const css = readSource("./styles.css");
  // .screen 让出滚动：详情页在文档流里占满剩余高度，内部由 .relay-detail-body 滚。
  assert.match(css, /\.screen:has\(\.relay-detail-page\) \{\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;/);
  // 详情页本身不再是覆盖 .screen 的 absolute 层。
  const rule = css.match(/\.screen \.relay-detail-page \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /position: relative;/);
  assert.match(rule, /inset: auto;/);
  assert.match(rule, /flex: 1 1 auto;/);
});

test("侧栏与主界面已完全移除 Claude 本地模式与网关绑定入口；Rust 后台监听已禁用", () => {
  const entry = functionSource("App");
  assert.doesNotMatch(entry, /claudeLocalRun|claudeRun|claude_local_status|claude_local_action|<ClaudeLocalizationScreen/);
  const lib = readSource("../src-tauri/src/lib.rs");
  assert.doesNotMatch(lib, /gateway_commands::start_from_saved_state_in_background|gateway_commands::start_model_watch|gateway_commands::set_app_handle|claude_local_backend::resume_attached_proxy|cu_pip::start/);
});
