/**
 * 托盘快捷面板（仅保留 Codex 概览、直连状态与常用入口）。
 * 会拉起进程的操作（启动 / 重启 / 停止 Codex）发给主窗口执行。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  Check,
  ExternalLink,
  House,
  MessagesSquare,
  Play,
  Plug,
  RefreshCw,
  RotateCw,
  Settings,
  Square,
  type LucideIcon,
} from "lucide-react";
import { t, tf } from "./i18n";
import { AGENT_ICONS, APP_LOGO_URL } from "./gateway-ui";
import {
  activeRelayItem,
  codexEnhanced,
  codexState,
  TRAY_REQUEST_EVENT,
  TRAY_RESULT_EVENT,
  type CodexState,
  type TrayOverview,
  type TrayRequest,
  type TrayResult,
  type TrayRoute,
  type TraySettings,
} from "./tray-panel-model";
import { applyResolvedTheme, loadThemePreference, resolveTheme, systemPrefersDark, watchSystemTheme } from "./theme-mode";
import "./GatewayPage.css";
import "./TrayPanel.css";

/** 面板与主窗口共用主题设置（主窗口写在 localStorage 里），跟随系统时按当前系统外观。 */
function applyTheme() {
  applyResolvedTheme(resolveTheme(loadThemePreference(), systemPrefersDark()));
}

const REFRESH_MS = 5000;
/** 发给主窗口的请求最多等这么久（启动 Codex 本身最多等 30 秒）。 */
const REQUEST_TIMEOUT_MS = 90_000;

type Pending = { id: string; kind: TrayRequest["kind"]; target?: string };
type Flash = { tone: "ok" | "error"; text: string };

export function TrayPanel() {
  const [overview, setOverview] = useState<TrayOverview | null>(null);
  const [settings, setSettings] = useState<TraySettings | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingRef = useRef<Pending | null>(null);

  const loadOverview = async () => {
    try {
      setOverview(await invoke<TrayOverview>("load_overview"));
    } catch {
      // 读不到时保持上一次的状态。
    }
  };
  const loadSettings = async () => {
    try {
      const result = await invoke<{ settings?: TraySettings }>("load_settings");
      if (result.settings) setSettings(result.settings);
    } catch {
      // 同上。
    }
  };

  const loadAll = async () => {
    await Promise.all([loadOverview(), loadSettings()]);
  };

  useEffect(() => {
    applyTheme();
    void loadAll();
    const onStorage = () => applyTheme();
    const onFocus = () => {
      applyTheme();
      void loadAll();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    const stopWatchingSystemTheme = watchSystemTheme(() => applyTheme());
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      stopWatchingSystemTheme();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAll();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主窗口做完面板发去的请求后回一个结果。
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<TrayResult>(TRAY_RESULT_EVENT, (event) => {
      const result = event.payload;
      const current = pendingRef.current;
      if (disposed || !current || !result || result.id !== current.id) return;
      finishPending(current, result.ok, result.message);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const finishPending = (current: Pending, ok: boolean, message?: string) => {
    pendingRef.current = null;
    setPending(null);
    if (current.kind !== "navigate") {
      if (!ok) setFlash({ tone: "error", text: message || t("没有完成，详情见主窗口。") });
    }
    void loadAll();
  };

  /**
   * 轻量模式下主窗口关掉后已销毁（#2677）：发请求前让后端按需在后台重建主窗口，
   * 并等它的前端注册好监听，否则请求没人接、只能等超时。失败也照常发，由超时兜底。
   */
  const prepareMainWindow = () => invoke<boolean>("main_window_prepare").catch(() => false);

  /** 把请求发给主窗口。同一时间只处理一个。 */
  const request = async (body: { kind: "launch" | "restart" | "stop" }, target?: string) => {
    if (pendingRef.current) return;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const next: Pending = { id, kind: body.kind, target };
    pendingRef.current = next;
    setPending(next);
    setFlash(null);
    window.setTimeout(() => {
      if (pendingRef.current?.id === id) finishPending(next, false, t("主窗口没有回应，请打开 Codex++ 查看。"));
    }, REQUEST_TIMEOUT_MS);
    try {
      await prepareMainWindow();
      await emit(TRAY_REQUEST_EVENT, { ...body, id } satisfies TrayRequest);
    } catch (error) {
      finishPending(next, false, String(error));
    }
  };

  /** 在主窗口打开某页：先让主窗口切页，再把它叫出来（面板随之收起）。 */
  const openRoute = async (route: TrayRoute) => {
    try {
      await prepareMainWindow();
      await emit(TRAY_REQUEST_EVENT, { id: `nav-${Date.now().toString(36)}`, kind: "navigate", route } satisfies TrayRequest);
    } catch {
      // 切页失败也照样打开主窗口。
    }
    void invoke("tray_panel_action", { action: "open" });
  };

  const action = (name: "open" | "quit") => void invoke("tray_panel_action", { action: name });

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const state = codexState(overview);

  return (
    <div className="gateway-page tray-panel">
      <header className="tp-head" data-tauri-drag-region>
        <img alt="" src={APP_LOGO_URL} />
        <div className="tp-head-title" data-tauri-drag-region>
          <strong>Codex++</strong>
          <span data-tauri-drag-region>
            <i className="tp-dot" data-tone={codexTone(state)} />
            {codexStateText(state)}
          </span>
        </div>
        <button aria-label={t("刷新")} className="gw-icon-button" onClick={() => void refreshNow()} title={t("刷新")} type="button">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        <button aria-label={t("打开 Codex++")} className="gw-icon-button" onClick={() => action("open")} title={t("打开 Codex++")} type="button">
          <ExternalLink className="h-4 w-4" />
        </button>
      </header>

      <div className="tp-body" role="tabpanel">
        <HomeTab
          onOpenRoute={openRoute}
          onRequest={request}
          overview={overview}
          pending={pending}
          settings={settings}
        />
      </div>

      {flash ? (
        <div className="tp-flash" data-tone={flash.tone} role="status">
          {flash.text}
        </div>
      ) : null}

      <footer className="tp-foot">
        <button className="tp-foot-button" onClick={() => void openRoute("settings")} type="button">
          <Settings aria-hidden="true" />
          {t("设置")}
        </button>
        <span />
        <button className="tp-foot-button" onClick={() => action("quit")} type="button">{t("退出")}</button>
      </footer>
    </div>
  );
}

function codexTone(state: CodexState): string {
  return state === "running" ? "on" : state === "missing" ? "error" : "off";
}

function codexStateText(state: CodexState): string {
  if (state === "running") return t("Codex 运行中");
  if (state === "stopped") return t("Codex 未运行");
  if (state === "missing") return t("没有找到 Codex");
  return t("正在检查 Codex…");
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="tp-section">
      <div className="tp-section-head">
        <span>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* —————————————— 概览 —————————————— */

const QUICK_LINKS: Array<{ route: TrayRoute; label: string; icon: LucideIcon }> = [
  { route: "overview", label: "Codex 概览", icon: House },
  { route: "relay", label: "连接与供应商", icon: Plug },
  { route: "sessions", label: "会话", icon: MessagesSquare },
  { route: "settings", label: "设置", icon: Settings },
];

function HomeTab({
  overview,
  settings,
  pending,
  onRequest,
  onOpenRoute,
}: {
  overview: TrayOverview | null;
  settings: TraySettings | null;
  pending: Pending | null;
  onRequest: (body: { kind: "launch" | "restart" | "stop" }) => Promise<void>;
  onOpenRoute: (route: TrayRoute) => Promise<void>;
}) {
  const state = codexState(overview);
  const active = activeRelayItem(settings);
  const busy = pending !== null;
  const busyKind = pending && pending.kind !== "navigate" ? pending.kind : null;
  const connection = settings?.relayProfilesEnabled === false
    ? t("供应商配置已关闭")
    : !active
      ? t("还没有配置供应商")
      : tf("直连 · {0}", [active.name || t("未命名供应商")]);
  return (
    <>
      <div className="tp-card tp-codex">
        <div className="tp-codex-top">
          <img alt="" src={AGENT_ICONS.codexApp} />
          <div className="tp-codex-name">
            <strong>Codex</strong>
            <small>{overview?.codex_version ? `v${overview.codex_version}` : state === "missing" ? t("没有找到 Codex 应用") : "—"}</small>
          </div>
          <span className="tp-state" data-tone={codexTone(state)}>
            <i className="tp-dot" data-tone={codexTone(state)} />
            {state === "running" ? t("运行中") : state === "stopped" ? t("未运行") : state === "missing" ? t("未找到") : t("检查中")}
          </span>
        </div>
        <div className="tp-codex-facts">
          <span title={active?.detail}>
            <Plug aria-hidden="true" />
            {connection}
          </span>
          {state === "running" ? (
            <span>
              <Check aria-hidden="true" />
              {codexEnhanced(overview) ? t("增强功能已生效") : t("增强功能未连接")}
            </span>
          ) : null}
        </div>
        <div className="tp-codex-actions">
          {state === "running" ? (
            <>
              <button className="tp-button" data-variant="primary" disabled={busy} onClick={() => void onRequest({ kind: "restart" })} type="button">
                <RotateCw aria-hidden="true" className={busyKind === "restart" ? "animate-spin" : ""} />
                {busyKind === "restart" ? t("正在重启…") : t("重启 Codex")}
              </button>
              <button className="tp-button" disabled={busy} onClick={() => void onRequest({ kind: "stop" })} type="button">
                <Square aria-hidden="true" />
                {busyKind === "stop" ? t("正在停止…") : t("停止")}
              </button>
            </>
          ) : (
            <button className="tp-button" data-variant="primary" disabled={busy || state === "missing"} onClick={() => void onRequest({ kind: "launch" })} type="button">
              <Play aria-hidden="true" />
              {busyKind === "launch" ? t("正在启动…") : t("启动 Codex")}
            </button>
          )}
        </div>
      </div>

      <Section title={t("快速打开")}>
        <div className="tp-quick">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <button className="tp-quick-item" key={link.route} onClick={() => void onOpenRoute(link.route)} type="button">
                <Icon aria-hidden="true" />
                <span>{t(link.label)}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
