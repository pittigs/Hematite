use anyhow::{Context, Result};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(300);

/// Live debounced filesystem watcher for a vault directory.
/// Automatically stops its background debounce thread when dropped.
pub struct VaultWatcher {
    _watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
    wake_tx: Sender<()>,
    worker: Option<JoinHandle<()>>,
}

impl VaultWatcher {
    pub fn start<F>(vault_path: &Path, on_change: F) -> Result<Self>
    where
        F: Fn() + Send + 'static,
    {
        Self::start_boxed(vault_path, Box::new(on_change))
    }

    pub fn start_boxed(
        vault_path: &Path,
        on_change: Box<dyn Fn() + Send + 'static>,
    ) -> Result<Self> {
        let canonical_root = fs::canonicalize(vault_path).unwrap_or_else(|_| vault_path.to_path_buf());
        let (tx, rx) = mpsc::channel::<()>();
        let stop = Arc::new(AtomicBool::new(false));

        let stop_for_cb = Arc::clone(&stop);
        let tx_for_cb = tx.clone();
        let root_for_cb = canonical_root.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if stop_for_cb.load(Ordering::SeqCst) {
                return;
            }
            if let Ok(event) = res {
                if should_notify_event(&root_for_cb, &event) {
                    let _ = tx_for_cb.send(());
                }
            }
        })
        .context("Failed to initialize filesystem watcher")?;

        watcher
            .watch(&canonical_root, RecursiveMode::Recursive)
            .with_context(|| format!("Failed to watch vault directory {}", canonical_root.display()))?;

        let stop_for_worker = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("oxidevault-watcher".to_string())
            .spawn(move || {
                let mut pending_since: Option<Instant> = None;

                loop {
                    if stop_for_worker.load(Ordering::SeqCst) {
                        break;
                    }

                    if let Some(last_ev) = pending_since {
                        let elapsed = last_ev.elapsed();
                        if elapsed >= DEBOUNCE_WINDOW {
                            pending_since = None;
                            if !stop_for_worker.load(Ordering::SeqCst) {
                                on_change();
                            }
                            continue;
                        }
                        let wait = DEBOUNCE_WINDOW - elapsed;
                        match rx.recv_timeout(wait) {
                            Ok(()) => {
                                if stop_for_worker.load(Ordering::SeqCst) {
                                    break;
                                }
                                pending_since = Some(Instant::now());
                            }
                            Err(RecvTimeoutError::Timeout) => {
                                pending_since = None;
                                if !stop_for_worker.load(Ordering::SeqCst) {
                                    on_change();
                                }
                            }
                            Err(RecvTimeoutError::Disconnected) => break,
                        }
                    } else {
                        match rx.recv() {
                            Ok(()) => {
                                if stop_for_worker.load(Ordering::SeqCst) {
                                    break;
                                }
                                pending_since = Some(Instant::now());
                            }
                            Err(_) => break,
                        }
                    }
                }
            })
            .context("Failed to spawn watcher debounce thread")?;

        Ok(Self {
            _watcher: watcher,
            stop,
            wake_tx: tx,
            worker: Some(worker),
        })
    }
}

impl Drop for VaultWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.wake_tx.send(());
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

fn should_notify_event(vault_root: &Path, event: &Event) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    if event.paths.is_empty() {
        return false;
    }
    event
        .paths
        .iter()
        .any(|path| !is_ignored_path(vault_root, path))
}

/// Returns true if `path` falls inside ignored directories (`.sync`, `.trash`, `.git`,
/// `node_modules`, `target`, `dist`) or represents a hidden/temporary file (`.` prefix,
/// `~` suffix, `.tmp` suffix).
pub fn is_ignored_path(vault_root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(vault_root).unwrap_or(path);
    for comp in rel.components() {
        if let Component::Normal(os_str) = comp {
            let name = os_str.to_string_lossy();
            if name.starts_with('.')
                || matches!(
                    name.as_ref(),
                    ".sync" | ".trash" | ".git" | "node_modules" | "target" | "dist"
                )
            {
                return true;
            }
        }
    }

    if let Some(file_name) = rel.file_name().and_then(|s| s.to_str()) {
        if file_name.starts_with('.') || file_name.ends_with('~') || file_name.ends_with(".tmp") {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tempfile::tempdir;

    #[test]
    fn ignores_internal_directories_and_temp_files() {
        let root = Path::new("/tmp/vault");
        assert!(is_ignored_path(root, &root.join(".sync/node_0001.oplog")));
        assert!(is_ignored_path(root, &root.join(".trash/trash-1.md")));
        assert!(is_ignored_path(root, &root.join(".git/HEAD")));
        assert!(is_ignored_path(root, &root.join("node_modules/pkg/index.js")));
        assert!(is_ignored_path(root, &root.join("target/debug/app")));
        assert!(is_ignored_path(root, &root.join("dist/bundle.js")));
        assert!(is_ignored_path(root, &root.join(".hidden.md")));
        assert!(is_ignored_path(root, &root.join("note.md~")));
        assert!(is_ignored_path(root, &root.join("note.md.tmp")));

        assert!(!is_ignored_path(root, &root.join("Note.md")));
        assert!(!is_ignored_path(root, &root.join("daily/2026-11-23.md")));
        assert!(!is_ignored_path(root, &root.join("canvas/board.canvas")));
    }

    #[test]
    fn watcher_debounces_burst_and_stops_cleanly_on_drop() {
        let dir = tempdir().unwrap();
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_cb = Arc::clone(&counter);

        let watcher = VaultWatcher::start(dir.path(), move || {
            counter_cb.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();

        // Ignored file should not trigger callback
        fs::create_dir_all(dir.path().join(".sync")).unwrap();
        fs::write(dir.path().join(".sync/a_0001.oplog"), "{}\n").unwrap();
        fs::write(dir.path().join("draft.md.tmp"), "temp").unwrap();
        thread::sleep(Duration::from_millis(450));
        assert_eq!(counter.load(Ordering::SeqCst), 0);

        // Rapid burst of writes to a real markdown note should debounce into a single notification
        for i in 0..4 {
            fs::write(dir.path().join("Note.md"), format!("# Update {}", i)).unwrap();
            thread::sleep(Duration::from_millis(40));
        }

        // Wait for debounce window to flush
        let deadline = Instant::now() + Duration::from_secs(3);
        while counter.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        let hits = counter.load(Ordering::SeqCst);
        assert!(hits >= 1 && hits <= 2, "expected debounced callback, got {}", hits);

        // Dropping watcher must terminate worker thread cleanly without hanging
        drop(watcher);
    }
}
