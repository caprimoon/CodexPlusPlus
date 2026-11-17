//! 拓展表单 `format: "file"` 契约与 `/image-overlay/image` 安全读取约束测试。
use codex_plus_core::bundled_extensions::{
    IMAGE_OVERLAY_KEY, image_overlay_files, image_overlay_image,
};
use codex_plus_core::user_scripts::UserScriptManager;
use serde_json::{Map, Value, json};

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

fn write_image_overlay_fixture(root: &std::path::Path) -> UserScriptManager {
    let dir = root.join("bundled").join("image-overlay");
    std::fs::create_dir_all(&dir).unwrap();
    for (relative, content) in image_overlay_files() {
        let target = dir.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(target, content).unwrap();
    }
    manager(root)
}

#[test]
fn file_format_is_only_accepted_on_string_fields() {
    let temp = tempfile::tempdir().unwrap();
    let manager = manager(temp.path());
    let write = |id: &str, config: Value| {
        let dir = temp.path().join("user").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        let manifest = json!({ "id": id, "renderer": ["main.js"], "engines": { "codexpp": 1 }, "config": config });
        std::fs::write(dir.join("codexpp.json"), manifest.to_string()).unwrap();
        std::fs::write(dir.join("main.js"), "").unwrap();
    };
    write("ok-file", json!({ "path": { "type": "string", "format": "file", "extensions": ["txt"] } }));
    write("bad-kind", json!({ "count": { "type": "number", "format": "file" } }));
    write("bad-format", json!({ "path": { "type": "string", "format": "folder" } }));
    write("bad-extension", json!({ "path": { "type": "string", "format": "file", "extensions": [".png"] } }));
    write("orphan-extensions", json!({ "path": { "type": "string", "extensions": ["png"] } }));
    assert_eq!(script(&manager, "user:ok-file")["error"], "");
    for id in ["bad-kind", "bad-format", "bad-extension", "orphan-extensions"] {
        let error = script(&manager, &format!("user:{id}"))["error"].as_str().unwrap().to_string();
        assert!(error.contains("format") || error.contains("extensions"), "{id}: {error}");
    }
}

#[test]
fn image_route_reads_only_the_path_saved_in_the_extension_config() {
    let temp = tempfile::tempdir().unwrap();
    let manager = write_image_overlay_fixture(temp.path());
    let save = |path: &str| {
        let mut values = Map::new();
        values.insert("imagePath".into(), json!(path));
        manager.set_extension_config(IMAGE_OVERLAY_KEY, &values).unwrap();
    };
    assert_eq!(image_overlay_image(&manager)["status"], "empty");

    let png = temp.path().join("wall.png");
    std::fs::write(&png, [0x89, b'P', b'N', b'G']).unwrap();
    save(&png.to_string_lossy());
    let result = image_overlay_image(&manager);
    assert_eq!(result["status"], "ok");
    assert_eq!(result["dataUrl"], "data:image/png;base64,iVBORw==");

    save(&temp.path().join("missing.png").to_string_lossy());
    assert_eq!(image_overlay_image(&manager)["status"], "failed");
    let text = temp.path().join("notes.txt");
    std::fs::write(&text, "secret").unwrap();
    save(&text.to_string_lossy());
    let result = image_overlay_image(&manager);
    assert_eq!(result["status"], "failed", "不是图片就不读");
    assert!(result.get("dataUrl").is_none());
}
