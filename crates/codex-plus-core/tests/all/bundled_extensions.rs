//! 已下线的官方默认外部拓展清理与自定义默认拓展包预装契约测试。
use codex_plus_core::bundled_extensions::{
    AGENT_PET_DIR, AGENT_PET_KEY, IMAGE_OVERLAY_DIR, IMAGE_OVERLAY_KEY, LIVE_WALLPAPER_ID,
    LIVE_WALLPAPER_KEY, PROXY_REQUEST_STATUS_DIR, PROXY_REQUEST_STATUS_KEY, RETIRED_BUNDLED_DIRS,
    RETIRED_BUNDLED_KEYS, TOKENLENS_KEY, TOKENLENS_MARKET_ID, TYPING_EFFECTS_DIR,
    TYPING_EFFECTS_KEY, USAGE_STATUSLINE_DIR, USAGE_STATUSLINE_KEY, materialize, packages,
    seed_default_extensions,
};
use codex_plus_core::extension_discovery::{CHANNEL_COMMUNITY, CommunityStore};
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
fn seed_default_extensions_installs_live_wallpaper_disabled_and_tokenlens_enabled_once() {
    let temp = tempfile::tempdir().unwrap();
    let mgr = manager(temp.path());

    assert!(seed_default_extensions(temp.path(), &mgr).unwrap());

    let wallpaper = script(&mgr, LIVE_WALLPAPER_KEY);
    assert_eq!(wallpaper["error"], "", "{wallpaper}");
    assert_eq!(wallpaper["kind"], "package");
    assert_eq!(wallpaper["enabled"], false, "动态壁纸默认安装且停用");
    assert_eq!(wallpaper["package"]["id"], LIVE_WALLPAPER_ID);

    let community = CommunityStore::new(temp.path()).load_state();
    let record = community.installs.get(LIVE_WALLPAPER_ID).unwrap();
    assert_eq!(record.repo, "luojinghao/codex-live-wallpaper");
    assert_eq!(record.version, "1.2.0");
    assert_eq!(record.channel, CHANNEL_COMMUNITY);

    let tokenlens = script(&mgr, TOKENLENS_KEY);
    assert_eq!(tokenlens["error"], "", "{tokenlens}");
    assert_eq!(tokenlens["kind"], "script");
    assert_eq!(tokenlens["enabled"], true, "TokenLens for Codex 默认安装且启用");
    let config = mgr.load_config();
    let market_record = config.market.get(TOKENLENS_KEY).unwrap();
    assert_eq!(market_record.id, TOKENLENS_MARKET_ID);
    assert_eq!(
        market_record.homepage,
        "https://github.com/LingYingNX/TokenLens-for-Codex"
    );

    // 用户后续停用/删除其中之一后，再次启动不能强行恢复。
    mgr.set_script_enabled(LIVE_WALLPAPER_KEY, true).unwrap();
    mgr.delete_user_script(TOKENLENS_KEY).unwrap();
    assert!(!seed_default_extensions(temp.path(), &mgr).unwrap());
    assert_eq!(script(&mgr, LIVE_WALLPAPER_KEY)["enabled"], true);
    assert!(
        mgr.inventory().unwrap()["scripts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["key"] != TOKENLENS_KEY),
        "用户卸载后不应重新写回"
    );
}
