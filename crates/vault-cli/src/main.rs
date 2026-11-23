use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use vault_core::model::{Block, CanvasData, DatabaseQuery, Document, TaskStatus};
use vault_core::watcher::VaultWatcher;
use vault_core::VaultEngine;

const MAX_POST_BODY_BYTES: u64 = 10 * 1024 * 1024;
const DEFAULT_CORS_ORIGIN: &str = "http://localhost:5173";

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "init-demo" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let mut engine = VaultEngine::open(&vault_path, None)?;
            let stats = engine.seed_demo()?;
            println!(
                "Demo-Vault initialisiert in: {}\nDokumente: {}, Blöcke: {}, Links: {}, Tasks: {} ({:.2} ms)",
                engine.vault_path().display(),
                stats.total_documents,
                stats.total_blocks,
                stats.total_links,
                stats.total_tasks,
                stats.elapsed_ms
            );
        }
        "index" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let mut engine = VaultEngine::open(&vault_path, None)?;
            let stats = engine.reindex_vault()?;
            println!("{}", serde_json::to_string_pretty(&stats)?);
        }
        "search" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let query = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let engine = VaultEngine::open(&vault_path, None)?;
            let res = engine.search_fts(query, 20)?;
            println!(
                "FTS5 Suche '{}' -> {} Treffer in {} µs ({:.3} ms)",
                res.query,
                res.total_hits,
                res.elapsed_us,
                res.elapsed_us as f64 / 1000.0
            );
            for hit in res.results {
                println!(
                    "  [{}] ({}) {} -> {}",
                    hit.doc_title, hit.block_id, hit.snippet, hit.doc_path
                );
            }
        }
        "tasks" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let engine = VaultEngine::open(&vault_path, None)?;
            let tasks = engine.get_tasks(None)?;
            for t in tasks {
                println!(
                    "[{:?}] {} ({}) deadline={:?} scheduled={:?}",
                    t.status, t.content, t.doc_title, t.deadline_at, t.scheduled_at
                );
            }
        }
        "graph" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let engine = VaultEngine::open(&vault_path, None)?;
            let snap = engine.get_graph_snapshot(true)?;
            println!(
                "Graph: {} Knoten, {} Kanten, {} Cluster, Layout berechnet in {} µs ({:.2} ms)",
                snap.nodes.len(),
                snap.edges.len(),
                snap.cluster_count,
                snap.computed_in_us,
                snap.computed_in_us as f64 / 1000.0
            );
        }
        "sync-sim" => {
            let vault_path = args
                .get(2)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./demo-vault"));
            let mut engine = VaultEngine::open(&vault_path, None)?;
            let report = engine.simulate_crdt_sync()?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        "bench-100k" => {
            println!("Starte 100.000-Blöcke Rust-Benchmark (5.000 .md Dateien x 20 Blöcke)...");
            let report = VaultEngine::run_100k_benchmark()?;
            println!("============================================================");
            println!("OxideVault 100.000-Blöcke Benchmark Ergebnisse");
            println!("============================================================");
            println!("Dateien generiert:      {}", report.file_count);
            println!("Blöcke indexiert:       {}", report.block_count);
            println!("Links/Tags extrahiert:  {}", report.link_count);
            println!("Tasks extrahiert:       {}", report.task_count);
            println!("Dateigenerierung:       {:.2} ms", report.generation_ms);
            println!(
                "Kalt-Indexierung:       {:.2} ms ({:.0} Blöcke/s)",
                report.cold_index_ms, report.blocks_per_sec
            );
            println!(
                "Delta-Sync (1 Datei):   {:.2} ms ({} unverändert übersprungen)",
                report.delta_sync_1_file_ms, report.delta_files_skipped
            );
            println!(
                "FTS5 Volltextsuche:     {} µs ({} Treffer)",
                report.fts_search_us, report.fts_hits
            );
            println!(
                "Graph Build & Layout:   {:.2} ms",
                report.graph_build_layout_ms
            );
            println!("SQLite DB Größe:        {:.2} MB", report.db_size_mb);
            println!("============================================================");
        }
        "serve" => {
            let mut vault_path = PathBuf::from("./demo-vault");
            let mut port: u16 = 3456;
            let mut cli_token: Option<String> = None;
            let mut i = 2;
            while i < args.len() {
                match args[i].as_str() {
                    "--vault" if i + 1 < args.len() => {
                        vault_path = PathBuf::from(&args[i + 1]);
                        i += 2;
                    }
                    "--port" if i + 1 < args.len() => {
                        port = args[i + 1].parse().unwrap_or(3456);
                        i += 2;
                    }
                    "--token" if i + 1 < args.len() => {
                        cli_token = Some(args[i + 1].clone());
                        i += 2;
                    }
                    _ => i += 1,
                }
            }
            let api_token = cli_token
                .or_else(|| env::var("OXIDEVAULT_API_TOKEN").ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            serve_http(vault_path, port, api_token)?;
        }
        _ => {
            println!(
                "OxideVault CLI\n\nBefehle:\n  init-demo [path]\n  index [path]\n  search [path] <query>\n  tasks [path]\n  graph [path]\n  sync-sim [path]\n  bench-100k\n  serve [--vault <path>] [--port <port>] [--token <secret>]"
            );
        }
    }

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMarkdownReq {
    rel_path: String,
    markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBlocksReq {
    rel_path: String,
    document: Document,
    blocks: Vec<Block>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDocReq {
    rel_path: String,
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelPathReq {
    rel_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameDocReq {
    old_rel_path: String,
    new_rel_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterializeReq {
    rel_path: String,
    block_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleTaskReq {
    block_id: String,
    status: TaskStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyReq {
    date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreTrashReq {
    trash_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreSnapshotReq {
    snapshot_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkMentionReq {
    source_doc_path: String,
    block_id: String,
    mention_text: String,
    target_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePropertyReq {
    rel_path: String,
    key: String,
    value: String,
}

fn serve_http(vault_path: PathBuf, port: u16, api_token: Option<String>) -> Result<()> {
    let mut engine = VaultEngine::open(&vault_path, None)?;
    if engine.list_documents()?.is_empty() {
        engine.seed_demo()?;
    }
    let shared = Arc::new(Mutex::new(engine));

    let watcher_shared = Arc::clone(&shared);
    let _watcher = VaultWatcher::start(&vault_path, move || {
        if let Ok(mut eng) = watcher_shared.lock() {
            let _ = eng.reindex_vault();
        }
    })
    .ok();

    let addr = format!("127.0.0.1:{}", port);
    let server = Server::http(&addr).map_err(|e| anyhow!("HTTP bind error on {}: {}", addr, e))?;
    println!(
        "OxideVault Rust API Server läuft auf http://{} (Vault: {}, Auth: {})",
        addr,
        vault_path.display(),
        if api_token.is_some() {
            "Bearer Token aktiv"
        } else {
            "aus"
        }
    );

    for mut req in server.incoming_requests() {
        let origin_header = get_header_value(&req, "origin");
        let cors_origin = resolve_cors_origin(origin_header.as_deref());

        if req.method() == &Method::Options {
            let mut resp = Response::empty(StatusCode(204));
            add_cors_headers(&mut resp, &cors_origin);
            let _ = req.respond(resp);
            continue;
        }

        if let Some(ref expected_token) = api_token {
            let auth_header = get_header_value(&req, "authorization");
            if !is_authorized(auth_header.as_deref(), expected_token) {
                let body = serde_json::json!({ "error": "Unauthorized" }).to_string();
                let mut resp = Response::from_string(body).with_status_code(401);
                resp.add_header(
                    Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json; charset=utf-8"[..],
                    )
                    .unwrap(),
                );
                add_cors_headers(&mut resp, &cors_origin);
                let _ = req.respond(resp);
                continue;
            }
        }

        let response = match handle_request(&shared, &mut req) {
            Ok(json_str) => {
                let mut resp = Response::from_string(json_str).with_status_code(200);
                resp.add_header(
                    Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json; charset=utf-8"[..],
                    )
                    .unwrap(),
                );
                add_cors_headers(&mut resp, &cors_origin);
                resp
            }
            Err(err) => {
                let body = serde_json::json!({ "error": err.to_string() }).to_string();
                let mut resp = Response::from_string(body).with_status_code(400);
                resp.add_header(
                    Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json; charset=utf-8"[..],
                    )
                    .unwrap(),
                );
                add_cors_headers(&mut resp, &cors_origin);
                resp
            }
        };
        let _ = req.respond(response);
    }

    Ok(())
}

fn get_header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn is_authorized(auth_header: Option<&str>, expected_token: &str) -> bool {
    let Some(header) = auth_header else {
        return false;
    };
    let Some(provided) = header.strip_prefix("Bearer ") else {
        return false;
    };
    provided == expected_token
}

fn resolve_cors_origin(origin: Option<&str>) -> String {
    if let Some(raw) = origin {
        let trimmed = raw.trim();
        if is_allowed_localhost_origin(trimmed) {
            return trimmed.to_string();
        }
    }
    DEFAULT_CORS_ORIGIN.to_string()
}

fn is_allowed_localhost_origin(origin: &str) -> bool {
    let rest = if let Some(r) = origin.strip_prefix("http://localhost") {
        r
    } else if let Some(r) = origin.strip_prefix("http://127.0.0.1") {
        r
    } else {
        return false;
    };

    if rest.is_empty() {
        return true;
    }
    if let Some(port_str) = rest.strip_prefix(':') {
        return !port_str.is_empty() && port_str.bytes().all(|b| b.is_ascii_digit());
    }
    false
}

fn add_cors_headers<R: Read>(resp: &mut Response<R>, allow_origin: &str) {
    if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], allow_origin.as_bytes())
    {
        resp.add_header(h);
    }
    resp.add_header(Header::from_bytes(&b"Vary"[..], &b"Origin"[..]).unwrap());
    resp.add_header(
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..])
            .unwrap(),
    );
    resp.add_header(
        Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            &b"Content-Type, Authorization"[..],
        )
        .unwrap(),
    );
}

fn read_capped_body<R: Read>(reader: R, max_bytes: u64) -> Result<String> {
    let mut buf = Vec::new();
    reader.take(max_bytes + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > max_bytes {
        return Err(anyhow!(
            "Request body exceeds maximum size of {} bytes",
            max_bytes
        ));
    }
    String::from_utf8(buf).map_err(|e| anyhow!("Invalid UTF-8 request body: {}", e))
}

fn handle_request(shared: &Arc<Mutex<VaultEngine>>, req: &mut Request) -> Result<String> {
    let url = req.url().to_string();
    let method = req.method().clone();

    let body_str = if method == Method::Post {
        read_capped_body(req.as_reader(), MAX_POST_BODY_BYTES)?
    } else {
        String::new()
    };

    dispatch_route(shared, method, &url, &body_str)
}

fn dispatch_route(
    shared: &Arc<Mutex<VaultEngine>>,
    method: Method,
    url: &str,
    body_str: &str,
) -> Result<String> {
    let (path, query_str) = url.split_once('?').unwrap_or((url, ""));
    let params = parse_query_params(query_str);

    if path == "/api/benchmark/100k" && method == Method::Post {
        let report = VaultEngine::run_100k_benchmark()?;
        return Ok(serde_json::to_string(&report)?);
    }

    let mut engine = shared.lock().map_err(|_| anyhow!("Engine lock poisoned"))?;

    match (method, path) {
        (Method::Get, "/api/health") => Ok(serde_json::json!({ "ok": true }).to_string()),
        (Method::Get, "/api/overview") => Ok(serde_json::to_string(&engine.get_overview()?)?),
        (Method::Get, "/api/revision") => {
            Ok(serde_json::json!({ "revision": engine.revision() }).to_string())
        }
        (Method::Post, "/api/reindex") => Ok(serde_json::to_string(&engine.reindex_vault()?)?),
        (Method::Get, "/api/documents") => Ok(serde_json::to_string(&engine.list_documents()?)?),
        (Method::Get, "/api/document") => {
            let target = params
                .get("target")
                .ok_or_else(|| anyhow!("Missing target query param"))?;
            Ok(serde_json::to_string(&engine.get_document(target)?)?)
        }
        (Method::Post, "/api/document/save-markdown") => {
            let payload: SaveMarkdownReq = serde_json::from_str(body_str)?;
            let res = engine.save_markdown_document(&payload.rel_path, &payload.markdown)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/document/save-blocks") => {
            let payload: SaveBlocksReq = serde_json::from_str(body_str)?;
            let res =
                engine.save_document_blocks(&payload.rel_path, payload.document, payload.blocks)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/document/create") => {
            let payload: CreateDocReq = serde_json::from_str(body_str)?;
            let res = engine.create_document(&payload.rel_path, payload.title.as_deref())?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/document/delete") => {
            let payload: RelPathReq = serde_json::from_str(body_str)?;
            engine.delete_document(&payload.rel_path)?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        (Method::Post, "/api/document/rename") => {
            let payload: RenameDocReq = serde_json::from_str(body_str)?;
            let res = engine.rename_document(&payload.old_rel_path, &payload.new_rel_path)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/document/property") => {
            let payload: UpdatePropertyReq = serde_json::from_str(body_str)?;
            let res =
                engine.update_document_property(&payload.rel_path, &payload.key, &payload.value)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/block/materialize") => {
            let payload: MaterializeReq = serde_json::from_str(body_str)?;
            let id = engine.materialize_block_id(&payload.rel_path, &payload.block_id)?;
            Ok(serde_json::json!({ "blockId": id }).to_string())
        }
        (Method::Get, "/api/block") => {
            let id = params.get("id").ok_or_else(|| anyhow!("Missing id"))?;
            Ok(serde_json::to_string(&engine.get_block_by_id(id)?)?)
        }
        (Method::Get, "/api/search") => {
            let q = params.get("q").map(|s| s.as_str()).unwrap_or("");
            let limit = params
                .get("limit")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(25);
            Ok(serde_json::to_string(&engine.search_fts(q, limit)?)?)
        }
        (Method::Get, "/api/backlinks") => {
            let doc_id = params
                .get("docId")
                .ok_or_else(|| anyhow!("Missing docId"))?;
            Ok(serde_json::to_string(&engine.get_backlinks(doc_id)?)?)
        }
        (Method::Get, "/api/unlinked-mentions") => {
            let doc_id = params
                .get("docId")
                .ok_or_else(|| anyhow!("Missing docId"))?;
            Ok(serde_json::to_string(
                &engine.get_unlinked_mentions(doc_id)?,
            )?)
        }
        (Method::Post, "/api/unlinked-mentions/link") => {
            let payload: LinkMentionReq = serde_json::from_str(body_str)?;
            engine.link_unlinked_mention(
                &payload.source_doc_path,
                &payload.block_id,
                &payload.mention_text,
                &payload.target_title,
            )?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        (Method::Get, "/api/tasks") => {
            let status = params.get("status").map(|s| TaskStatus::from_db_str(s));
            Ok(serde_json::to_string(&engine.get_tasks(status)?)?)
        }
        (Method::Post, "/api/tasks/toggle") => {
            let payload: ToggleTaskReq = serde_json::from_str(body_str)?;
            let res = engine.toggle_task_status(&payload.block_id, payload.status)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/daily") => {
            let payload: DailyReq = if body_str.trim().is_empty() {
                DailyReq { date: None }
            } else {
                serde_json::from_str(body_str)?
            };
            let res = engine.open_or_create_daily_note(payload.date.as_deref())?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/database/query") => {
            let query: DatabaseQuery = serde_json::from_str(body_str)?;
            Ok(serde_json::to_string(&engine.query_database(&query)?)?)
        }
        (Method::Get, "/api/graph") => {
            let include_tags = params
                .get("includeTags")
                .map(|s| s == "true")
                .unwrap_or(true);
            Ok(serde_json::to_string(
                &engine.get_graph_snapshot(include_tags)?,
            )?)
        }
        (Method::Get, "/api/graph/path") => {
            let from = params.get("from").ok_or_else(|| anyhow!("Missing from"))?;
            let to = params.get("to").ok_or_else(|| anyhow!("Missing to"))?;
            Ok(serde_json::to_string(&engine.find_graph_path(from, to)?)?)
        }
        (Method::Get, "/api/canvas") => {
            let path = params
                .get("path")
                .map(|s| s.as_str())
                .unwrap_or("canvas/System-Architektur.canvas");
            Ok(serde_json::to_string(&engine.get_canvas(path)?)?)
        }
        (Method::Post, "/api/canvas/save") => {
            let canvas: CanvasData = serde_json::from_str(body_str)?;
            engine.save_canvas_data(&canvas)?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        (Method::Post, "/api/canvas/create") => {
            let payload: RelPathReq = serde_json::from_str(body_str)?;
            let canvas = engine.create_canvas(&payload.rel_path)?;
            Ok(serde_json::to_string(&canvas)?)
        }
        (Method::Post, "/api/canvas/delete") => {
            let payload: RelPathReq = serde_json::from_str(body_str)?;
            engine.delete_canvas(&payload.rel_path)?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        (Method::Get, "/api/sync/status") => Ok(serde_json::to_string(&engine.get_sync_status()?)?),
        (Method::Post, "/api/sync/simulate") => {
            Ok(serde_json::to_string(&engine.simulate_crdt_sync()?)?)
        }
        (Method::Post, "/api/sync/apply") => {
            Ok(serde_json::to_string(&engine.apply_remote_sync()?)?)
        }
        (Method::Post, "/api/sync/compact") => {
            Ok(serde_json::to_string(&engine.compact_sync_oplogs()?)?)
        }
        (Method::Get, "/api/trash") => Ok(serde_json::to_string(&engine.list_trash()?)?),
        (Method::Post, "/api/trash/restore") => {
            let payload: RestoreTrashReq = serde_json::from_str(body_str)?;
            let res = engine.restore_trash_item(&payload.trash_id)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Post, "/api/trash/empty") => {
            let removed = engine.empty_trash()?;
            Ok(serde_json::json!({ "removed": removed }).to_string())
        }
        (Method::Get, "/api/snapshots") => {
            let rel_path = params
                .get("path")
                .ok_or_else(|| anyhow!("Missing path query param"))?;
            Ok(serde_json::to_string(&engine.list_snapshots(rel_path)?)?)
        }
        (Method::Post, "/api/snapshots/restore") => {
            let payload: RestoreSnapshotReq = serde_json::from_str(body_str)?;
            let res = engine.restore_snapshot(payload.snapshot_id)?;
            Ok(serde_json::to_string(&res)?)
        }
        (Method::Get, "/api/analytics") => {
            Ok(serde_json::to_string(&engine.get_vault_analytics()?)?)
        }
        (Method::Post, "/api/optimize") => Ok(serde_json::to_string(&engine.optimize_index()?)?),
        _ => Err(anyhow!("Unknown endpoint: {}", path)),
    }
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(k), percent_decode(v));
    }
    map
}

fn percent_decode(input: &str) -> String {
    let replaced = input.replace('+', " ");
    let bytes = replaced.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn parses_query_params_and_percent_encoding() {
        let params = parse_query_params("q=Rust+Core&target=daily%2F2026-11-21.md&empty=");
        assert_eq!(params.get("q").map(String::as_str), Some("Rust Core"));
        assert_eq!(
            params.get("target").map(String::as_str),
            Some("daily/2026-11-21.md")
        );
        assert_eq!(params.get("empty").map(String::as_str), Some(""));
    }

    #[test]
    fn percent_decode_handles_utf8_and_invalid_sequences() {
        assert_eq!(
            percent_decode("Architektur%20%26%20Sync"),
            "Architektur & Sync"
        );
        assert_eq!(percent_decode("100%ZZok"), "100%ZZok");
    }

    #[test]
    fn cors_origin_validation_restricts_to_localhost() {
        assert_eq!(
            resolve_cors_origin(Some("http://localhost:5173")),
            "http://localhost:5173"
        );
        assert_eq!(
            resolve_cors_origin(Some("http://127.0.0.1:4173")),
            "http://127.0.0.1:4173"
        );
        assert_eq!(
            resolve_cors_origin(Some("http://localhost")),
            "http://localhost"
        );
        assert_eq!(
            resolve_cors_origin(Some("http://localhost.evil.com")),
            DEFAULT_CORS_ORIGIN
        );
        assert_eq!(
            resolve_cors_origin(Some("https://evil.example.com")),
            DEFAULT_CORS_ORIGIN
        );
        assert_eq!(resolve_cors_origin(None), DEFAULT_CORS_ORIGIN);
    }

    #[test]
    fn bearer_token_auth_validates_exact_secret() {
        assert!(is_authorized(Some("Bearer s3cr3t"), "s3cr3t"));
        assert!(!is_authorized(Some("Bearer wrong"), "s3cr3t"));
        assert!(!is_authorized(Some("Basic s3cr3t"), "s3cr3t"));
        assert!(!is_authorized(None, "s3cr3t"));
    }

    #[test]
    fn read_capped_body_enforces_limit() {
        let ok = read_capped_body(Cursor::new("hello"), 5).unwrap();
        assert_eq!(ok, "hello");
        assert!(read_capped_body(Cursor::new("hello!"), 5).is_err());
    }

    #[test]
    fn dispatches_all_new_api_routes_end_to_end() {
        let dir = std::env::temp_dir().join(format!(
            "oxidevault_cli_route_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let vault_dir = dir.join("vault");
        let db_path = dir.join("index.sqlite");
        let engine = VaultEngine::open(&vault_dir, Some(db_path)).unwrap();
        let shared = Arc::new(Mutex::new(engine));

        // Revision endpoint
        let rev_json = dispatch_route(&shared, Method::Get, "/api/revision", "").unwrap();
        let rev_val: serde_json::Value = serde_json::from_str(&rev_json).unwrap();
        assert_eq!(rev_val["revision"].as_u64(), Some(1));

        // Create two documents, test property update, snapshots, unlinked mentions, analytics, optimize
        dispatch_route(
            &shared,
            Method::Post,
            "/api/document/save-markdown",
            r##"{"relPath":"Alpha.md","markdown":"# Alpha\n\nTarget note.\n"}"##,
        )
        .unwrap();
        dispatch_route(
            &shared,
            Method::Post,
            "/api/document/save-markdown",
            r##"{"relPath":"Beta.md","markdown":"# Beta\n\nMentions Alpha without link.\n"}"##,
        )
        .unwrap();

        // Update frontmatter property
        let prop_json = dispatch_route(
            &shared,
            Method::Post,
            "/api/document/property",
            r#"{"relPath":"Alpha.md","key":"status","value":"active"}"#,
        )
        .unwrap();
        let prop_doc: serde_json::Value = serde_json::from_str(&prop_json).unwrap();
        assert_eq!(prop_doc["document"]["frontmatter"]["status"], "active");

        // List & restore snapshots
        let snaps_json =
            dispatch_route(&shared, Method::Get, "/api/snapshots?path=Alpha.md", "").unwrap();
        let snaps: Vec<serde_json::Value> = serde_json::from_str(&snaps_json).unwrap();
        assert_eq!(snaps.len(), 2);
        let first_snap_id = snaps.last().unwrap()["id"].as_i64().unwrap();
        let restored_snap_json = dispatch_route(
            &shared,
            Method::Post,
            "/api/snapshots/restore",
            &format!(r#"{{"snapshotId":{}}}"#, first_snap_id),
        )
        .unwrap();
        assert!(restored_snap_json.contains("Target note."));

        // Unlinked mentions & link conversion
        let alpha_id = prop_doc["document"]["id"].as_str().unwrap();
        let mentions_json = dispatch_route(
            &shared,
            Method::Get,
            &format!("/api/unlinked-mentions?docId={}", alpha_id),
            "",
        )
        .unwrap();
        let mentions: Vec<serde_json::Value> = serde_json::from_str(&mentions_json).unwrap();
        assert_eq!(mentions.len(), 1);
        let blk_id = mentions[0]["sourceBlockId"].as_str().unwrap();
        dispatch_route(
            &shared,
            Method::Post,
            "/api/unlinked-mentions/link",
            &format!(
                r#"{{"sourceDocPath":"Beta.md","blockId":"{}","mentionText":"Alpha","targetTitle":"Alpha"}}"#,
                blk_id
            ),
        )
        .unwrap();
        let mentions_after_json = dispatch_route(
            &shared,
            Method::Get,
            &format!("/api/unlinked-mentions?docId={}", alpha_id),
            "",
        )
        .unwrap();
        let mentions_after: Vec<serde_json::Value> =
            serde_json::from_str(&mentions_after_json).unwrap();
        assert!(mentions_after.is_empty());

        // Analytics & optimize
        let analytics_json = dispatch_route(&shared, Method::Get, "/api/analytics", "").unwrap();
        let analytics: serde_json::Value = serde_json::from_str(&analytics_json).unwrap();
        assert_eq!(analytics["totalDocuments"].as_u64(), Some(2));
        let opt_json = dispatch_route(&shared, Method::Post, "/api/optimize", "{}").unwrap();
        let opt: serde_json::Value = serde_json::from_str(&opt_json).unwrap();
        assert!(opt["dbSizeAfterBytes"].as_u64().is_some());

        // Canvas create & delete
        let canvas_json = dispatch_route(
            &shared,
            Method::Post,
            "/api/canvas/create",
            r#"{"relPath":"canvas/TestBoard"}"#,
        )
        .unwrap();
        assert!(canvas_json.contains("canvas/TestBoard.canvas"));
        dispatch_route(
            &shared,
            Method::Post,
            "/api/canvas/delete",
            r#"{"relPath":"canvas/TestBoard.canvas"}"#,
        )
        .unwrap();

        // Sync simulate, apply, compact
        dispatch_route(&shared, Method::Post, "/api/sync/simulate", "{}").unwrap();
        let apply_json = dispatch_route(&shared, Method::Post, "/api/sync/apply", "{}").unwrap();
        let apply: serde_json::Value = serde_json::from_str(&apply_json).unwrap();
        assert_eq!(apply["opsApplied"].as_u64(), Some(2));
        let compact_json =
            dispatch_route(&shared, Method::Post, "/api/sync/compact", "{}").unwrap();
        let compact: serde_json::Value = serde_json::from_str(&compact_json).unwrap();
        assert!(compact["filesAfter"].as_u64().is_some());

        // Trash delete, list, restore, and empty
        dispatch_route(
            &shared,
            Method::Post,
            "/api/document/delete",
            r#"{"relPath":"Beta.md"}"#,
        )
        .unwrap();
        let trash_json = dispatch_route(&shared, Method::Get, "/api/trash", "").unwrap();
        let trash: Vec<serde_json::Value> = serde_json::from_str(&trash_json).unwrap();
        assert_eq!(trash.len(), 1);
        let trash_id = trash[0]["trashId"].as_str().unwrap();
        dispatch_route(
            &shared,
            Method::Post,
            "/api/trash/restore",
            &format!(r#"{{"trashId":"{}"}}"#, trash_id),
        )
        .unwrap();

        // Delete again and empty trash
        dispatch_route(
            &shared,
            Method::Post,
            "/api/document/delete",
            r#"{"relPath":"Beta.md"}"#,
        )
        .unwrap();
        let empty_json = dispatch_route(&shared, Method::Post, "/api/trash/empty", "{}").unwrap();
        let empty: serde_json::Value = serde_json::from_str(&empty_json).unwrap();
        assert_eq!(empty["removed"].as_u64(), Some(1));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
