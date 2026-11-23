use anyhow::{anyhow, Context, Result};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tempfile::NamedTempFile;

/// Validates and resolves a relative path inside `vault_path`, rejecting path traversal
/// (`..`), absolute paths, NUL bytes, and empty paths.
pub fn resolve_safe_vault_path(vault_path: &Path, raw_rel_path: &str) -> Result<(String, PathBuf)> {
    let trimmed = raw_rel_path.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Pfad darf nicht leer sein"));
    }
    if trimmed.contains('\0') {
        return Err(anyhow!("Pfad enthält ungültige Zeichen"));
    }

    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(anyhow!(
            "Absolute Pfade sind im Vault nicht erlaubt: {}",
            raw_rel_path
        ));
    }

    let mut clean_parts: Vec<String> = Vec::new();
    for comp in Path::new(&normalized).components() {
        match comp {
            Component::Normal(part) => {
                let s = part
                    .to_str()
                    .ok_or_else(|| anyhow!("Ungültige UTF-8-Pfadkomponente"))?;
                if s.is_empty() || s == "." {
                    continue;
                }
                // Reject Windows drive prefixes like `C:`
                if clean_parts.is_empty() && s.ends_with(':') {
                    return Err(anyhow!(
                        "Absolute Laufwerkspfade sind nicht erlaubt: {}",
                        raw_rel_path
                    ));
                }
                clean_parts.push(s.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!(
                    "Path-Traversal außerhalb des Vaults blockiert: {}",
                    raw_rel_path
                ));
            }
        }
    }

    if clean_parts.is_empty() {
        return Err(anyhow!("Ungültiger leerer Vault-Pfad: {}", raw_rel_path));
    }

    let clean_rel = clean_parts.join("/");
    let abs_path = vault_path.join(&clean_rel);
    Ok((clean_rel, abs_path))
}

/// Validates a relative Markdown path inside `vault_path` and ensures it ends with `.md`.
pub fn normalize_safe_md_path(vault_path: &Path, raw_rel_path: &str) -> Result<(String, PathBuf)> {
    let (mut clean_rel, _) = resolve_safe_vault_path(vault_path, raw_rel_path)?;
    if !clean_rel.ends_with(".md") {
        clean_rel.push_str(".md");
    }
    let abs_path = vault_path.join(&clean_rel);
    Ok((clean_rel, abs_path))
}

/// Atomically writes `contents` to `path` via a sibling temporary file and atomic rename.
/// Prevents partially written or corrupted files during crashes or active cloud syncs.
pub fn atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Zielpfad hat kein Elternverzeichnis: {}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Konnte Verzeichnis nicht erstellen: {}", parent.display()))?;

    let mut tmp = NamedTempFile::new_in(parent)
        .with_context(|| format!("Konnte temporäre Datei in {} nicht anlegen", parent.display()))?;
    tmp.write_all(contents.as_ref())
        .with_context(|| format!("Schreibfehler bei temporärer Datei für {}", path.display()))?;
    tmp.as_file()
        .sync_all()
        .with_context(|| format!("Sync-Fehler für {}", path.display()))?;
    tmp.persist(path)
        .map_err(|e| anyhow!("Atomares Umbenennen nach {} fehlgeschlagen: {}", path.display(), e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_path_traversal_and_absolute_paths() {
        let dir = tempdir().unwrap();
        assert!(resolve_safe_vault_path(dir.path(), "../secret.md").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "notes/../../etc/passwd").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "/etc/passwd").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "C:\\Windows\\win.ini").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "   ").is_err());
        assert!(resolve_safe_vault_path(dir.path(), "foo\0bar.md").is_err());
    }

    #[test]
    fn accepts_valid_nested_paths_and_normalizes_md() {
        let dir = tempdir().unwrap();
        let (rel, abs) = normalize_safe_md_path(dir.path(), "daily/2026-11-21").unwrap();
        assert_eq!(rel, "daily/2026-11-21.md");
        assert_eq!(abs, dir.path().join("daily/2026-11-21.md"));

        let (rel2, _) = normalize_safe_md_path(dir.path(), "./notes\\Rust.md").unwrap();
        assert_eq!(rel2, "notes/Rust.md");
    }

    #[test]
    fn atomic_write_creates_parents_and_overwrites_cleanly() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("sub/dir/test.md");
        atomic_write(&target, "erste version").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "erste version");

        atomic_write(&target, "zweite version").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "zweite version");
    }
}
