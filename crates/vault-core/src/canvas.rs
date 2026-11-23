use crate::fs_utils::{atomic_write, resolve_safe_vault_path};
use crate::model::{CanvasData, CanvasEdge, CanvasNode};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasFilePayload {
    nodes: Vec<CanvasNode>,
    edges: Vec<CanvasEdge>,
}

pub fn list_canvas_files(vault_path: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(vault_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.depth() > 0 && (name.starts_with('.') || name == "node_modules"))
        })
    {
        let entry = entry?;
        if entry.file_type().is_file()
            && entry.path().extension().and_then(|s| s.to_str()) == Some("canvas")
        {
            if let Ok(rel) = entry.path().strip_prefix(vault_path) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    files.sort();
    Ok(files)
}

pub fn load_canvas(vault_path: &Path, rel_path: &str) -> Result<CanvasData> {
    let (clean_rel, abs) = resolve_safe_vault_path(vault_path, rel_path)?;
    if !abs.exists() {
        return Ok(CanvasData {
            path: clean_rel,
            nodes: Vec::new(),
            edges: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&abs)
        .with_context(|| format!("Failed to read canvas {}", abs.display()))?;
    let payload: CanvasFilePayload = serde_json::from_str(&raw)
        .with_context(|| format!("Failed to parse canvas JSON {}", abs.display()))?;
    Ok(CanvasData {
        path: clean_rel,
        nodes: payload.nodes,
        edges: payload.edges,
    })
}

pub fn save_canvas(vault_path: &Path, canvas: &CanvasData) -> Result<()> {
    let (_, abs) = resolve_safe_vault_path(vault_path, &canvas.path)?;
    let payload = CanvasFilePayload {
        nodes: canvas.nodes.clone(),
        edges: canvas.edges.clone(),
    };
    let json = serde_json::to_string_pretty(&payload)?;
    atomic_write(&abs, json)?;
    Ok(())
}

pub fn normalize_safe_canvas_path(vault_path: &Path, rel_path: &str) -> Result<(String, std::path::PathBuf)> {
    let (mut clean_rel, _) = resolve_safe_vault_path(vault_path, rel_path)?;
    if !clean_rel.ends_with(".canvas") {
        clean_rel.push_str(".canvas");
    }
    let abs = vault_path.join(&clean_rel);
    Ok((clean_rel, abs))
}

pub fn create_canvas(vault_path: &Path, rel_path: &str) -> Result<CanvasData> {
    let (clean_rel, abs) = normalize_safe_canvas_path(vault_path, rel_path)?;
    if abs.exists() {
        return load_canvas(vault_path, &clean_rel);
    }
    let canvas = CanvasData {
        path: clean_rel,
        nodes: Vec::new(),
        edges: Vec::new(),
    };
    save_canvas(vault_path, &canvas)?;
    Ok(canvas)
}

pub fn delete_canvas(vault_path: &Path, rel_path: &str) -> Result<String> {
    let (clean_rel, abs) = resolve_safe_vault_path(vault_path, rel_path)?;
    if !clean_rel.ends_with(".canvas") {
        return Err(anyhow!(
            "Nur .canvas-Dateien können gelöscht werden: {}",
            clean_rel
        ));
    }
    if abs.exists() {
        fs::remove_file(&abs)
            .with_context(|| format!("Failed to delete canvas {}", abs.display()))?;
    }
    Ok(clean_rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn canvas_roundtrip_and_path_traversal_protection() {
        let dir = tempdir().unwrap();
        let canvas = CanvasData {
            path: "canvas/test.canvas".to_string(),
            nodes: vec![CanvasNode {
                id: "n1".to_string(),
                node_type: "text".to_string(),
                x: 10.0,
                y: 20.0,
                width: 240.0,
                height: 120.0,
                title: Some("Notiz".to_string()),
                text: Some("Hallo Canvas".to_string()),
                ref_doc_path: None,
                ref_block_id: None,
                color: Some("#6366f1".to_string()),
            }],
            edges: vec![],
        };
        save_canvas(dir.path(), &canvas).unwrap();
        let loaded = load_canvas(dir.path(), "canvas/test.canvas").unwrap();
        assert_eq!(loaded.nodes.len(), 1);
        assert_eq!(loaded.nodes[0].text.as_deref(), Some("Hallo Canvas"));

        // Path traversal must be rejected
        assert!(load_canvas(dir.path(), "../escape.canvas").is_err());
        let bad_canvas = CanvasData {
            path: "../escape.canvas".to_string(),
            nodes: vec![],
            edges: vec![],
        };
        assert!(save_canvas(dir.path(), &bad_canvas).is_err());
    }

    #[test]
    fn create_and_delete_canvas_enforce_extension_and_safety() {
        let dir = tempdir().unwrap();
        let created = create_canvas(dir.path(), "canvas/ideas").unwrap();
        assert_eq!(created.path, "canvas/ideas.canvas");
        assert!(dir.path().join("canvas/ideas.canvas").exists());

        // Calling create_canvas on an existing board preserves its content
        let mut with_node = created.clone();
        with_node.nodes.push(CanvasNode {
            id: "n-keep".to_string(),
            node_type: "text".to_string(),
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
            title: None,
            text: Some("Keep me".to_string()),
            ref_doc_path: None,
            ref_block_id: None,
            color: None,
        });
        save_canvas(dir.path(), &with_node).unwrap();
        let reopened = create_canvas(dir.path(), "canvas/ideas.canvas").unwrap();
        assert_eq!(reopened.nodes.len(), 1);

        // Reject deleting non-canvas or traversal paths
        assert!(delete_canvas(dir.path(), "notes.md").is_err());
        assert!(delete_canvas(dir.path(), "../evil.canvas").is_err());

        delete_canvas(dir.path(), "canvas/ideas.canvas").unwrap();
        assert!(!dir.path().join("canvas/ideas.canvas").exists());
    }
}
