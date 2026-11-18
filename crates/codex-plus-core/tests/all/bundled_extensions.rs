//! 已下线的官方默认外部拓展清理与自定义默认拓展包预装契约测试。
use codex_plus_core::bundled_extensions::{
    AGENT_PET_DIR, AGENT_PET_KEY, IMAGE_OVERLAY_DIR, IMAGE_OVERLAY_KEY, LIVE_WALLPAPER_ID,
    LIVE_WALLPAPER_KEY, PROXY_REQUEST_STATUS_DIR, PROXY_REQUEST_STATUS_KEY, RETIRED_BUNDLED_DIRS,
    RETIRED_BUNDLED_KEYS, TOKEN_PULSE_ID, TOKEN_PULSE_KEY, TYPING_EFFECTS_DIR,
    TYPING_EFFECTS_KEY, USAGE_STATUSLINE_DIR, USAGE_STATUSLINE_KEY, materialize, packages,
    seed_default_extensions,
};
use codex_plus_core::extension_discovery::{CHANNEL_COMMUNITY, CommunityStore, InstallRecord};
use codex_plus_core::script_market::MarketScript;
use codex_plus_core::user_scripts::UserScriptManager;
use serde_json::{Value, json};

fn manager(root: &std::path::Path) -> UserScriptManager {
    UserScriptManager::new(
        root.join("builtin"),
        root.join("user"),
        root.join("user_scripts.json"),
    )
    .with_bundled_dir(root.join("bundled"))
}

fn script(manager: &UserScriptManager, key: &str) -> Value {
    manager.inventory().unwrap()["scripts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key)
        .cloned()
        .unwrap()
}

#[test]
fn retired_official_bundled_packages_are_not_materialized_and_remnants_are_purged() {
    assert!(packages().is_empty(), "5 个官方默认外部拓展已完全移除");
    let temp = tempfile::tempdir().unwrap();
    let bundled = temp.path().join("bundled");
    for dir in [
        AGENT_PET_DIR,
        TYPING_EFFECTS_DIR,
        IMAGE_OVERLAY_DIR,
        USAGE_STATUSLINE_DIR,
        PROXY_REQUEST_STATUS_DIR,
    ] {
        let package_dir = bundled.join(dir);
        std::fs::create_dir_all(&package_dir).unwrap();
        std::fs::write(
            package_dir.join("codexpp.json"),
            json!({ "id": dir, "renderer": "main.js" }).to_string(),
        )
        .unwrap();
        std::fs::write(package_dir.join("main.js"), "").unwrap();
    }
    let mgr = manager(temp.path());
    for key in [
        AGENT_PET_KEY,
        TYPING_EFFECTS_KEY,
        IMAGE_OVERLAY_KEY,
        USAGE_STATUSLINE_KEY,
        PROXY_REQUEST_STATUS_KEY,
    ] {
        mgr.set_script_enabled(key, true).unwrap();
    }
    mgr.set_script_enabled("user:keep-me.js", true).unwrap();

    materialize(&bundled).unwrap();
    assert!(mgr.purge_retired_bundled_entries().unwrap());
    for dir in RETIRED_BUNDLED_DIRS {
        assert!(!bundled.join(dir).exists(), "{dir} 目录必须被清除");
    }
    let config = mgr.load_config();
    for key in RETIRED_BUNDLED_KEYS {
        assert!(!config.scripts.contains_key(*key), "{key} 开关记录必须被清除");
    }
    assert_eq!(config.scripts.get("user:keep-me.js"), Some(&true));
}

#[test]
fn seed_default_extensions_installs_live_canvas_disabled_and_token_pulse_enabled_once() {
    let temp = tempfile::tempdir().unwrap();
    let mgr = manager(temp.path());

    assert!(seed_default_extensions(temp.path(), &mgr).unwrap());

    let wallpaper = script(&mgr, LIVE_WALLPAPER_KEY);
    assert_eq!(wallpaper["error"], "", "{wallpaper}");
    assert_eq!(wallpaper["kind"], "package");
    assert_eq!(wallpaper["enabled"], false, "LiveCanvas 动态壁纸默认安装且停用");
    assert_eq!(wallpaper["package"]["id"], LIVE_WALLPAPER_ID);
    assert_eq!(wallpaper["package"]["version"], "1.0.0");

    let community = CommunityStore::new(temp.path()).load_state();
    let wallpaper_record = community.installs.get(LIVE_WALLPAPER_ID).unwrap();
    assert_eq!(wallpaper_record.repo, "caprimoon/codexpp-live-canvas");
    assert_eq!(wallpaper_record.version, "1.0.0");
    assert_eq!(wallpaper_record.tag, None);
    assert_eq!(
        wallpaper_record.sha,
        "527f9d3c1d34ec39d85c2174cf6294a1818208f7"
    );
    assert!(wallpaper_record.from_default_branch);
    assert_eq!(wallpaper_record.channel, CHANNEL_COMMUNITY);

    let token_pulse = script(&mgr, TOKEN_PULSE_KEY);
    assert_eq!(token_pulse["error"], "", "{token_pulse}");
    assert_eq!(token_pulse["kind"], "package");
    assert_eq!(token_pulse["enabled"], true, "TokenPulse 默认安装且启用");
    assert_eq!(token_pulse["package"]["id"], TOKEN_PULSE_ID);
    assert_eq!(token_pulse["package"]["version"], "1.0.5");

    let token_pulse_record = community.installs.get(TOKEN_PULSE_ID).unwrap();
    assert_eq!(token_pulse_record.repo, "caprimoon/codexpp-token-pulse");
    assert_eq!(token_pulse_record.version, "1.0.5");
    assert_eq!(token_pulse_record.tag, None);
    assert_eq!(
        token_pulse_record.sha,
        "50cac6babd058352f85b83fb42e614e8d21a3e5c"
    );
    assert!(token_pulse_record.from_default_branch);
    assert_eq!(token_pulse_record.channel, CHANNEL_COMMUNITY);

    // 用户后续停用/删除其中之一后，再次启动不能强行恢复。
    mgr.set_script_enabled(LIVE_WALLPAPER_KEY, true).unwrap();
    mgr.delete_user_script(TOKEN_PULSE_KEY).unwrap();
    assert!(!seed_default_extensions(temp.path(), &mgr).unwrap());
    assert_eq!(script(&mgr, LIVE_WALLPAPER_KEY)["enabled"], true);
    assert!(
        mgr.inventory().unwrap()["scripts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["key"] != TOKEN_PULSE_KEY),
        "用户卸载后不应重新写回"
    );
}

#[test]
fn seed_default_extensions_migrates_legacy_v1_defaults_to_caprimoon_packages() {
    let temp = tempfile::tempdir().unwrap();
    let mgr = manager(temp.path());
    std::fs::create_dir_all(mgr.user_dir().join(LIVE_WALLPAPER_ID)).unwrap();
    std::fs::write(
        mgr.user_dir().join(LIVE_WALLPAPER_ID).join("codexpp.json"),
        json!({ "id": LIVE_WALLPAPER_ID, "version": "1.2.0", "renderer": ["renderer.js"] })
            .to_string(),
    )
    .unwrap();
    std::fs::write(mgr.user_dir().join(LIVE_WALLPAPER_ID).join("renderer.js"), "// legacy").unwrap();
    mgr.set_script_enabled(LIVE_WALLPAPER_KEY, true).unwrap();
    CommunityStore::new(temp.path())
        .seed_install_record(
            LIVE_WALLPAPER_ID,
            InstallRecord {
                repo: "luojinghao/codex-live-wallpaper".to_string(),
                version: "1.2.0".to_string(),
                tag: Some("v1.2.0".to_string()),
                sha: "legacy-sha".to_string(),
                from_default_branch: false,
                from_asset: false,
                installed_at: 1,
                channel: CHANNEL_COMMUNITY.to_string(),
            },
        )
        .unwrap();

    let legacy_tokenlens = mgr.user_script_path_for_market_id("tokenlens-for-codex");
    std::fs::write(&legacy_tokenlens, "// legacy tokenlens").unwrap();
    mgr.seed_default_market_script(
        &MarketScript {
            id: "tokenlens-for-codex".to_string(),
            name: "TokenLens for Codex".to_string(),
            description: String::new(),
            version: "1.0.5".to_string(),
            author: "LingYingNX".to_string(),
            tags: Vec::new(),
            homepage: "https://github.com/LingYingNX/TokenLens-for-Codex".to_string(),
            script_url: String::new(),
            requirements: Vec::new(),
            limitations: Vec::new(),
            icon: String::new(),
            updated_at: String::new(),
        },
        true,
    )
    .unwrap();
    std::fs::write(temp.path().join(".custom_default_extensions_v1"), b"v1\n").unwrap();

    assert!(seed_default_extensions(temp.path(), &mgr).unwrap());

    assert!(!legacy_tokenlens.exists(), "旧版 market-tokenlens-for-codex.js 应被移除");
    assert!(!temp.path().join(".custom_default_extensions_v1").exists());
    assert!(temp.path().join(".custom_default_extensions_v3").exists());

    let wallpaper = script(&mgr, LIVE_WALLPAPER_KEY);
    assert_eq!(wallpaper["error"], "", "{wallpaper}");
    assert_eq!(wallpaper["enabled"], true, "升级应保留用户原有的动态壁纸开关状态");
    assert_eq!(
        CommunityStore::new(temp.path())
            .load_state()
            .installs
            .get(LIVE_WALLPAPER_ID)
            .unwrap()
            .repo,
        "caprimoon/codexpp-live-canvas"
    );

    let token_pulse = script(&mgr, TOKEN_PULSE_KEY);
    assert_eq!(token_pulse["error"], "", "{token_pulse}");
    assert_eq!(token_pulse["enabled"], true);
    assert_eq!(
        CommunityStore::new(temp.path())
            .load_state()
            .installs
            .get(TOKEN_PULSE_ID)
            .unwrap()
            .repo,
        "caprimoon/codexpp-token-pulse"
    );
    let config = mgr.load_config();
    assert!(!config.scripts.contains_key("user:market-tokenlens-for-codex.js"));
    assert!(!config.market.contains_key("user:market-tokenlens-for-codex.js"));
}

#[test]
fn seed_default_extensions_upgrades_v2_packages_and_respects_uninstalls() {
    let temp = tempfile::tempdir().unwrap();
    let mgr = manager(temp.path());

    // LiveCanvas 处于 v2 旧提交并由用户开启；TokenPulse 已被用户卸载。
    let wallpaper_dir = mgr.user_dir().join(LIVE_WALLPAPER_ID);
    std::fs::create_dir_all(&wallpaper_dir).unwrap();
    std::fs::write(
        wallpaper_dir.join("codexpp.json"),
        json!({ "id": LIVE_WALLPAPER_ID, "version": "1.0.0", "renderer": ["renderer.js"] })
            .to_string(),
    )
    .unwrap();
    std::fs::write(wallpaper_dir.join("renderer.js"), "// old v1.0.0 renderer").unwrap();
    mgr.set_script_enabled(LIVE_WALLPAPER_KEY, true).unwrap();

    let store = CommunityStore::new(temp.path());
    store
        .seed_install_record(
            LIVE_WALLPAPER_ID,
            InstallRecord {
                repo: "caprimoon/codexpp-live-canvas".to_string(),
                version: "1.0.0".to_string(),
                tag: Some("v1.0.0".to_string()),
                sha: "ee0eed0567dc88c68f93c7e5b2dcb55555248020".to_string(),
                from_default_branch: false,
                from_asset: false,
                installed_at: 1,
                channel: CHANNEL_COMMUNITY.to_string(),
            },
        )
        .unwrap();
    store
        .seed_install_record(
            TOKEN_PULSE_ID,
            InstallRecord {
                repo: "caprimoon/codexpp-token-pulse".to_string(),
                version: "1.0.5".to_string(),
                tag: Some("v1.0.5".to_string()),
                sha: "8560d110753f851b15a3cda1fe219a8b000b9640".to_string(),
                from_default_branch: false,
                from_asset: false,
                installed_at: 1,
                channel: CHANNEL_COMMUNITY.to_string(),
            },
        )
        .unwrap();
    std::fs::write(temp.path().join(".custom_default_extensions_v2"), b"v2\n").unwrap();

    assert!(seed_default_extensions(temp.path(), &mgr).unwrap());
    assert!(!temp.path().join(".custom_default_extensions_v2").exists());
    assert!(temp.path().join(".custom_default_extensions_v3").exists());

    // LiveCanvas 更新为性能优化提交并保留原有启用状态。
    let upgraded_renderer = std::fs::read_to_string(wallpaper_dir.join("renderer.js")).unwrap();
    assert!(upgraded_renderer.contains("pauseOnTask"));
    assert_eq!(script(&mgr, LIVE_WALLPAPER_KEY)["enabled"], true);
    let updated_record = store.load_state().installs.get(LIVE_WALLPAPER_ID).unwrap().clone();
    assert_eq!(updated_record.sha, "527f9d3c1d34ec39d85c2174cf6294a1818208f7");
    assert_eq!(updated_record.tag, None);
    assert!(updated_record.from_default_branch);

    // 用户已卸载的 TokenPulse 不应被重新装回。
    assert!(!mgr.user_dir().join(TOKEN_PULSE_ID).join("codexpp.json").exists());

    // 另一套同时保留旧版 TokenPulse（用户改为停用）的环境也会在迁移时升级并保持停用状态。
    let both = tempfile::tempdir().unwrap();
    let both_mgr = manager(both.path());
    let token_pulse_dir = both_mgr.user_dir().join(TOKEN_PULSE_ID);
    std::fs::create_dir_all(&token_pulse_dir).unwrap();
    std::fs::write(
        token_pulse_dir.join("codexpp.json"),
        json!({ "id": TOKEN_PULSE_ID, "version": "1.0.5", "renderer": ["tokenlens.js"] })
            .to_string(),
    )
    .unwrap();
    std::fs::write(token_pulse_dir.join("tokenlens.js"), "// old v1.0.5 tokenlens").unwrap();
    both_mgr.set_script_enabled(TOKEN_PULSE_KEY, false).unwrap();
    CommunityStore::new(both.path())
        .seed_install_record(
            TOKEN_PULSE_ID,
            InstallRecord {
                repo: "caprimoon/codexpp-token-pulse".to_string(),
                version: "1.0.5".to_string(),
                tag: Some("v1.0.5".to_string()),
                sha: "8560d110753f851b15a3cda1fe219a8b000b9640".to_string(),
                from_default_branch: false,
                from_asset: false,
                installed_at: 1,
                channel: CHANNEL_COMMUNITY.to_string(),
            },
        )
        .unwrap();
    std::fs::write(both.path().join(".custom_default_extensions_v2"), b"v2\n").unwrap();

    assert!(seed_default_extensions(both.path(), &both_mgr).unwrap());
    let upgraded_tokenlens = std::fs::read_to_string(token_pulse_dir.join("tokenlens.js")).unwrap();
    assert!(upgraded_tokenlens.contains("lastAnalyticsFingerprint"));
    assert_eq!(script(&both_mgr, TOKEN_PULSE_KEY)["enabled"], false);
    let token_record = CommunityStore::new(both.path())
        .load_state()
        .installs
        .get(TOKEN_PULSE_ID)
        .unwrap()
        .clone();
    assert_eq!(token_record.sha, "50cac6babd058352f85b83fb42e614e8d21a3e5c");
    assert_eq!(token_record.tag, None);
    assert!(token_record.from_default_branch);
}
