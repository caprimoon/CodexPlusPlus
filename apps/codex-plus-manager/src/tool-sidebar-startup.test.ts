import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("启动直接加载工具列表，不再发起广告或更新网络请求", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("    void refreshTools(true);"));
  const startup = effect.slice(0, effect.indexOf("  }, []);"));
  const events: string[] = [];
  const noOp = async () => {};
  const dependencies = {
    refreshTools: async () => { events.push("tools"); },
    consumePendingManagerNavigation: async () => false,
    refreshOverview: noOp,
    refreshSettings: noOp,
    refreshRelay: noOp,
    refreshEnvConflicts: noOp,
    refreshProviderSyncTargets: noOp,
    refreshPendingProviderImport: noOp,
    releaseMainWindowWhenHidden: () => {},
  };
  new Function(...Object.keys(dependencies), startup)(
    ...Object.values(dependencies),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes("tools"), "启动后应立即加载工具列表");
  assert.doesNotMatch(source, /refreshAds|checkUpdate\(|UPDATE_CHECK_INTERVAL_MS/);
});
