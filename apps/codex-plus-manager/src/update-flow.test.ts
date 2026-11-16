import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("版本与更新模块已从 UI、定时轮询与启动线程中剥离", () => {
  assert.doesNotMatch(app, /checkUpdate\(|performUpdate\(|downloadUpdateInBackground\(|UPDATE_CHECK_INTERVAL_MS|<UpdateDialog\b|app-settings-update/);
  assert.doesNotMatch(lib, /cleanup_stale_update_transactions|prune_installed_installers|show_update/);
});
