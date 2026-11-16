/** 首次使用引导：步骤定义与「看过没有」的记录。页面只负责高亮与摆放说明卡。 */

export type TourStep = {
  id: string;
  /** 要高亮的元素：`[data-tour="..."]`；没有目标的步骤（欢迎、结束）显示在屏幕中央。 */
  target?: string;
  title: string;
  body: string;
  /** 有值时标题和正文是 tf 模板，按它填 {0}。 */
  args?: string[];
  /** 只有正文是模板、标题仍是普通文案。 */
  plainTitle?: boolean;
};

/** 导览版本；入门清单使用独立记录，不因内容更新打扰已完成引导的用户。 */
export const TOUR_VERSION = 1;
export const TOUR_STORAGE_KEY = "codex-plus-plus.onboarding";

// 顺序跟着侧栏从上往下走：万物皆拓展 → Codex → 搜索 → 设置。
export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "欢迎使用 Codex++",
    body: "Codex++ 给 Codex 加上拓展、皮肤增强与直连供应商管理。花半分钟认识一下侧栏。",
  },
  {
    id: "management",
    target: "management",
    title: "拓展与增强",
    body: "Codex++ 的增强能力都以拓展开放：在这里启用内置拓展、安装社区拓展，或在 Codex 对话里说一句就造一个自己的。",
  },
  {
    id: "agents",
    target: "agents",
    title: "Codex 控制条",
    body: "概览、连接与供应商、MCP 与 Skills、会话与各增强页都在上方平铺直达；点这里可快速回到概览，右侧按钮随时启动、停止或挂载 Codex。",
  },
  {
    id: "palette",
    target: "palette",
    title: "搜索页面和操作",
    body: "结束导览后，按 ⌘K 搜索页面、开关和常用操作。",
  },
  {
    id: "settings",
    target: "settings",
    title: "设置",
    body: "主题、配置文件、日志诊断和 Codex 设置都在齿轮里。想再看一遍这个引导，在「设置 → 通用」里重新打开。",
  },
];

/**
 * 返回裁剪后的 Codex 专属导览步骤。
 */
export function tourSteps(_soloName: string | null = null, _enhanceOnly = false): TourStep[] {
  return TOUR_STEPS;
}

/** 是否需要自动弹出引导：没看过，或看的是旧版本。 */
export function shouldShowTour(stored: string | null): boolean {
  if (!stored) return true;
  const version = Number(stored);
  return !Number.isFinite(version) || version < TOUR_VERSION;
}

/** 说明卡放在目标的右侧；右边放不下就放左侧，再不行放到下方。返回卡片左上角坐标。 */
export function placeCard(
  target: { left: number; top: number; right: number; bottom: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 14,
): { left: number; top: number; side: "right" | "left" | "bottom" } {
  const clampTop = (top: number) => Math.max(12, Math.min(top, viewport.height - card.height - 12));
  const middle = (target.top + target.bottom) / 2 - card.height / 2;
  if (target.right + gap + card.width <= viewport.width - 12) return { left: target.right + gap, top: clampTop(middle), side: "right" };
  if (target.left - gap - card.width >= 12) return { left: target.left - gap - card.width, top: clampTop(middle), side: "left" };
  const left = Math.max(12, Math.min(target.left, viewport.width - card.width - 12));
  return { left, top: clampTop(target.bottom + gap), side: "bottom" };
}
