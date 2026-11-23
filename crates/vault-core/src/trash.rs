use crate::db::now_unix;
use crate::fs_utils::{atomic_write, normalize_safe_md_path, path_stem_str};
use crate::model::TrashItem;
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::Path;
use uuid::Uuid;

fn read_trash_index(vault_path: &Path) -> Result<Vec<TrashItem>> {
    let index_path = vault_path.join(".trash").join("index.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&index_path)?;
    let items: Vec<TrashItem> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(items)
}

fn write_trash_index(vault_path: &Path, items: &[TrashItem]) -> Result<()> {
    let index_path = vault_path.join(".trash").join("index.json");
    let json = serde_json::to_string_pretty(items)?;
    atomic_write(&index_path, json)?;
    Ok(())
}

/// Moves an existing Markdown file into `.trash/<trash_id>.md` and records its metadata
/// in `.trash/index.json`. Returns `Ok(None)` if `abs_path` does not exist on disk.
pub fn move_to_trash(
    vault_path: &Path,
    clean_rel: &str,
    abs_path: &Path,
    title: &str,
) -> Result<Option<TrashItem>> {
    if !abs_path.exists() {
        return Ok(None);
    }

    let content = fs::read(abs_path)
        .with_context(|| format!("Konnte {} nicht für Papierkorb lesen", abs_path.display()))?;
    let size_bytes = content.len() as u64;
    let deleted_at = now_unix();
    let trash_id = format!("trash-{}-{}", deleted_at, &Uuid::new_v4().to_string()[..8]);
    let trash_dir = vault_path.join(".trash");
    let trash_file = trash_dir.join(format!("{}.md", trash_id));

    atomic_write(&trash_file, &content)?;
    fs::remove_file(abs_path)?;

    let item = TrashItem {
        trash_id,
        original_path: clean_rel.to_string(),
        title: title.to_string(),
        deleted_at,
        size_bytes,
    };

    let mut items = read_trash_index(vault_path)?;
    items.push(item.clone());
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    write_trash_index(vault_path, &items)?;

    Ok(Some(item))
}

/// Lists all valid trashed items whose backing `.md` file still exists, newest first.
pub fn list_trash(vault_path: &Path) -> Result<Vec<TrashItem>> {
    let trash_dir = vault_path.join(".trash");
    let mut items: Vec<TrashItem> = read_trash_index(vault_path)?
        .into_iter()
        .filter(|item| trash_dir.join(format!("{}.md", item.trash_id)).exists())
        .collect();
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(items)
}

/// Returns the number of currently restorable items in `.trash/`.
pub fn trash_count(vault_path: &Path) -> Result<usize> {
    Ok(list_trash(vault_path)?.len())
}

/// Restores a trashed document back into the vault, choosing a unique ` (restored N).md`
/// path if a file already exists at the original path. Writes the restored file atomically,
/// removes it from `.trash/`, and returns `(dest_rel_path, content)`.
pub fn restore_from_trash(vault_path: &Path, trash_id: &str) -> Result<(String, String)> {
    let clean_id = trash_id.trim();
    if clean_id.is_empty()
        || clean_id.contains('/')
        || clean_id.contains('\\')
        || clean_id.contains("..")
    {
        return Err(anyhow!("Ungültige Papierkorb-ID: {}", trash_id));
    }

    let mut items = read_trash_index(vault_path)?;
    let pos = items
        .iter()
        .position(|item| item.trash_id == clean_id)
        .ok_or_else(|| anyhow!("Papierkorb-Eintrag nicht gefunden: {}", clean_id))?;
    let item = items[pos].clone();

    let trash_file = vault_path.join(".trash").join(format!("{}.md", clean_id));
    if !trash_file.exists() {
        return Err(anyhow!(
            "Papierkorb-Datei fehlt für Eintrag: {}",
            clean_id
        ));
    }
    let content = fs::read_to_string(&trash_file)?;

    let (orig_rel, orig_abs) = normalize_safe_md_path(vault_path, &item.original_path)?;
    let dest_rel = if !orig_abs.exists() {
        orig_rel
    } else {
        let parent = Path::new(&orig_rel)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|s| !s.is_empty());
        let stem = path_stem_str(&orig_rel);
        let mut n = 1usize;
        loop {
            let candidate_name = format!("{} (restored {}).md", stem, n);
            let candidate_rel = match &parent {
                Some(dir) => format!("{}/{}", dir, candidate_name),
                None => candidate_name,
            };
            if !vault_path.join(&candidate_rel).exists() {
                break candidate_rel;
            }
            n += 1;
        }
    };

    let dest_abs = vault_path.join(&dest_rel);
    atomic_write(&dest_abs, &content)?;
    let _ = fs::remove_file(&trash_file);
    items.remove(pos);
    write_trash_index(vault_path, &items)?;

    Ok((dest_rel, content))
}

/// Permanently deletes all trashed `.md` files and clears `.trash/index.json`.
pub fn empty_trash(vault_path: &Path) -> Result<usize> {
    let trash_dir = vault_path.join(".trash");
    if !trash_dir.exists() {
        return Ok(0);
    }
    let mut removed = 0usize;
    for entry in fs::read_dir(&trash_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            fs::remove_file(&path)?;
            removed += 1;
        }
    }
    write_trash_index(vault_path, &[])?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn move_list_count_and_restore_without_collision() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note_path = vault.join("notes/Idea.md");
        atomic_write(&note_path, "# Idea\n\nOriginal content.\n").unwrap();

        assert_eq!(trash_count(vault).unwrap(), 0);

        let moved = move_to_trash(vault, "notes/Idea.md", &note_path, "Idea")
            .unwrap()
            .expect("trash item");
        assert!(!note_path.exists());
        assert_eq!(moved.original_path, "notes/Idea.md");
        assert_eq!(moved.title, "Idea");
        assert_eq!(trash_count(vault).unwrap(), 1);
        assert_eq!(list_trash(vault).unwrap().len(), 1);

        let (dest_rel, content) = restore_from_trash(vault, &moved.trash_id).unwrap();
        assert_eq!(dest_rel, "notes/Idea.md");
        assert_eq!(content, "# Idea\n\nOriginal content.\n");
        assert!(note_path.exists());
        assert_eq!(trash_count(vault).unwrap(), 0);
    }

    #[test]
    fn restore_generates_unique_filename_on_collision_and_preserves_folder() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        let note_path = vault.join("sub/Memo.md");
        atomic_write(&note_path, "# Old Memo\n").unwrap();

        let moved = move_to_trash(vault, "sub/Memo.md", &note_path, "Memo")
            .unwrap()
            .unwrap();

        // Create conflicting files at both original and first restored slot
        atomic_write(&note_path, "# New Memo\n").unwrap();
        atomic_write(&vault.join("sub/Memo (restored 1).md"), "# First\n").unwrap();

        let (dest_rel, content) = restore_from_trash(vault, &moved.trash_id).unwrap();
        assert_eq!(dest_rel, "sub/Memo (restored 2).md");
        assert_eq!(content, "# Old Memo\n");
        assert!(vault.join(&dest_rel).exists());
    }

    #[test]
    fn rejects_invalid_trash_ids_and_handles_missing_files() {
        let dir = tempdir().unwrap();
        let vault = dir.path();

        assert!(move_to_trash(vault, "Missing.md", &vault.join("Missing.md"), "Missing")
            .unwrap()
            .is_none());
        assert!(restore_from_trash(vault, "").is_err());
        assert!(restore_from_trash(vault, "../escape").is_err());
        assert!(restore_from_trash(vault, "a/b").is_err());
        assert!(restore_from_trash(vault, "a\\b").is_err());
        assert!(restore_from_trash(vault, "nonexistent-id").is_err());
    }

    #[test]
    fn empty_trash_removes_all_files_and_is_idempotent() {
        let dir = tempdir().unwrap();
        let vault = dir.path();
        assert_eq!(empty_trash(vault).unwrap(), 0);

        for name in ["One.md", "Two.md"] {
            let p = vault.join(name);
            atomic_write(&p, format!("# {}\n", name)).unwrap();
            move_to_trash(vault, name, &p, name).unwrap();
        }
        assert_eq!(trash_count(vault).unwrap(), 2);

        let removed = empty_trash(vault).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(trash_count(vault).unwrap(), 0);
        assert_eq!(empty_trash(vault).unwrap(), 0);
    }
}
