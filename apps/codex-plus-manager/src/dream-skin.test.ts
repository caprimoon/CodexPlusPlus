import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

import {
  defaultDreamSkinTheme,
  isDreamSkinDraftDirty,
  normalizeDreamSkinTheme,
  resolveDreamSkinStylePreset,
  runExclusiveDreamSkinInstall,
} from "./dream-skin.ts";

describe("dream skin theme helpers", () => {
  it("uses the Codex-Dream-Skin theme.json defaults", () => {
    const theme = defaultDreamSkinTheme();

    assert.equal(theme.schemaVersion, 1);
    assert.equal(theme.name, "Dream Skin");
    assert.equal(theme.stylePreset, undefined);
    assert.equal(theme.brandSubtitle, "CODEX DREAM SKIN");
    assert.equal(theme.colors!.accent, "#E25563");
  });

  it("restores an invalid color without dropping valid text", () => {
    const base = defaultDreamSkinTheme();
    const theme = normalizeDreamSkinTheme({
      ...base,
      name: "My Theme",
      colors: { ...base.colors!, accent: "javascript:bad" },
    });

    assert.equal(theme.name, "My Theme");
    assert.equal(theme.colors!.accent, "#E25563");
  });

  it("maps legacy market themes to their layout presets", () => {
    assert.equal(resolveDreamSkinStylePreset("preset-cyber-neon", undefined), "cyber-neon");
    assert.equal(resolveDreamSkinStylePreset("codex-snow-skin", "dream-original"), "codex-snow");
    assert.equal(resolveDreamSkinStylePreset("custom-theme", undefined), "dream-original");
  });

  it("locks theme installation synchronously and releases the lock after completion", async () => {
    const lock = { current: false };
    const pending: boolean[] = [];
    let finish!: (value: boolean) => void;
    let runs = 0;
    const task = () => {
      runs += 1;
      return new Promise<boolean>((resolve) => { finish = resolve; });
    };

    const first = runExclusiveDreamSkinInstall(lock, (value) => pending.push(value), task);
    const duplicate = await runExclusiveDreamSkinInstall(lock, (value) => pending.push(value), task);

    assert.equal(duplicate, null);
    assert.equal(runs, 1);
    assert.equal(lock.current, true);
    assert.deepEqual(pending, [true]);

    finish(true);
    assert.equal(await first, true);
    assert.equal(lock.current, false);
    assert.deepEqual(pending, [true, false]);
  });

  it("releases the theme installation lock when the request throws", async () => {
    const lock = { current: false };
    const pending: boolean[] = [];

    await assert.rejects(
      runExclusiveDreamSkinInstall(lock, (value) => pending.push(value), async () => {
        throw new Error("network failed");
      }),
      /network failed/,
    );

    assert.equal(lock.current, false);
    assert.deepEqual(pending, [true, false]);
  });

  it("keeps the real task locked when the initiating view unmounts and remounts", async () => {
    const appLock = { current: false };
    let runs = 0;
    let finish!: (value: boolean) => void;
    const task = () => {
      runs += 1;
      return new Promise<boolean>((resolve) => { finish = resolve; });
    };
    const mountView = () => () => runExclusiveDreamSkinInstall(appLock, () => {}, task);

    const firstView = mountView();
    const activeTask = firstView();
    const remountedView = mountView();
    const duplicate = await remountedView();

    assert.equal(duplicate, null);
    assert.equal(runs, 1);
    assert.equal(appLock.current, true);

    finish(true);
    assert.equal(await activeTask, true);
    assert.equal(appLock.current, false);
  });
  it("removes DreamSkin manager screen, navigation entry, dialogs, and startup sync", async () => {
    const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
    const lib = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

    assert.doesNotMatch(app, /function DreamSkinScreen\(|<DreamSkinScreen\b|DreamSkinUnsavedDialog|DreamSkinCommunityLinkDialog|皮肤管理/);
    assert.doesNotMatch(app, /dreamSkinInstallOperation|refreshPendingDreamSkinCommunity/);
    assert.match(lib, /sync_default_dream_skin_base_theme\(\s*false,/);
    assert.doesNotMatch(lib, /handle_dream_skin_url\(/);
  });
});
