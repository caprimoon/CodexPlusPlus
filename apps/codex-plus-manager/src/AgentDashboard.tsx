/**
 * Codex 概览仪表板：一条状态行（版本 + 直连状态 + 切换/管理供应商）、
 * 「最近会话」列表、底部配置摘要，以及健康检查（children）。样式在 cx-pages-agents.css。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight } from "lucide-react";
import { t, tf } from "./i18n";
import { AgentGlyph } from "./HubOverview";
import { relativeTime, shortPath, type AgentSessionView } from "./gateway-model";
import { CxBadge, CxCard, CxEmpty, CxRow, CxSection, CxStatusIcon } from "./cx-layout";

export type DashboardAgent = "codex";
type Route = "context" | "skills";
type Result = { status: string; message: string };

/** 状态栏第二行：圆点颜色 + 一句话。 */
export type DashboardStatus = { tone: "gateway" | "drift" | "direct" | "relay" | "missing"; text: string };
export type DashboardStat = { label: string; value: ReactNode; tone?: "ok" | "warn"; mono?: boolean };

export function AgentDashboard({
  agent,
  name,
  version,
  status,
  actions,
  onNavigate,
  onOpenList,
  children,
}: {
  agent: DashboardAgent;
  name: string;
  version?: string | null;
  status?: DashboardStatus;
  actions?: ReactNode;
  stats?: DashboardStat[];
  onNavigate: (route: Route) => void;
  /** 打开会话页并选中这个 Agent。 */
  onOpenList: (kind: "sessions", agent: DashboardAgent) => void;
  notify?: (title: string, message: string, status?: string) => void;
  children?: ReactNode;
}) {
  const [sessions, setSessions] = useState<AgentSessionView[] | null>(null);
  const [mcpCount, setMcpCount] = useState<number | null>(null);
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const done = <T,>(apply: (value: T) => void) => (value: T) => { if (!cancelled) apply(value); };
    setSessions(null);
    invoke<{ sessions?: Array<{ id: string; title: string; cwd: string; updatedAtMs: number }> }>("list_local_sessions", { request: { offset: 0, limit: 20 } })
      .then((result) => (result.sessions ?? []).map((session): AgentSessionView => ({ agent: "codex", id: session.id, title: session.title, cwd: session.cwd, updatedAtMs: session.updatedAtMs })))
      .then(done((list) => setSessions([...list].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, 5))))
      .catch(done(() => setSessions([])));
    invoke<Result & { entries?: { mcpServers?: unknown[] } }>("read_live_context_entries")
      .then((result) => result.entries?.mcpServers?.length ?? 0)
      .then(done(setMcpCount))
      .catch(() => undefined);
    invoke<{ skills?: Array<{ installed?: boolean; agents?: string[] }> }>("list_installed_skills")
      .then(done((result) => setSkillCount((result.skills ?? []).filter((skill) => skill.installed && skill.agents?.includes(agent)).length)))
      .catch(() => undefined);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [agent]);

  const heroStatus: DashboardStatus = status ?? { tone: "direct", text: t("直连模式") };
  const configPath = "~/.codex/config.toml";
  const statusDot = ({ gateway: "ok", relay: "ok", drift: "warn", missing: "warn", direct: "off" } as const)[heroStatus.tone];

  return (
    <div className="cx-page cx-dash">
      {/* 状态行：Agent、版本、直连状态，右侧切换与管理。 */}
      <CxCard className="cx-dash-status">
        <CxRow
          badges={version ? <CxBadge>{version}</CxBadge> : null}
          detail={heroStatus.text}
          icon={<CxStatusIcon tone={statusDot}><AgentGlyph agent={agent} /></CxStatusIcon>}
          title={name}
        >
          {actions}
        </CxRow>
      </CxCard>

      <div className="cx-dash-lists" data-single="true">
        <CxSection
          aside={<button className="cx-dash-link" onClick={() => onOpenList("sessions", agent)} type="button">{t("全部")}<ArrowUpRight aria-hidden="true" size={13} /></button>}
          title={t("最近会话")}
        >
          <CxCard className="cx-dash-list">
            {sessions === null ? <CxEmpty title={t("读取中…")} /> : sessions.length === 0 ? (
              <CxEmpty title={tf("还没有 {0} 的本地会话。", [name])} />
            ) : sessions.map((session) => {
              const time = relativeTime(session.updatedAtMs, now);
              return (
                <CxRow detail={<span title={session.cwd}>{shortPath(session.cwd) || "~"}</span>} key={session.id} title={<span title={session.title}>{session.title || t("未命名会话")}</span>}>
                  <time className="cx-dash-time">{time.args.length ? tf(time.text, time.args) : t(time.text)}</time>
                </CxRow>
              );
            })}
          </CxCard>
        </CxSection>
      </div>

      <footer className="cx-dash-foot">
        <button onClick={() => onNavigate("context")} type="button">MCP <b>{mcpCount ?? "—"}</b><ArrowUpRight aria-hidden="true" size={12} /></button>
        <button onClick={() => onNavigate("skills")} type="button">Skills <b>{skillCount ?? "—"}</b><ArrowUpRight aria-hidden="true" size={12} /></button>
        {configPath ? <span title={configPath}>{t("配置文件")} <code>{shortPath(configPath)}</code></span> : null}
      </footer>

      {children}
    </div>
  );
}
