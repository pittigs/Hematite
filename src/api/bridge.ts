import { invoke } from "@tauri-apps/api/core";
import type {
  BacklinkItem,
  BenchmarkReport,
  Block,
  BlockLookup,
  CanvasData,
  DatabaseQuery,
  DatabaseQueryResult,
  Document,
  DocumentSnapshot,
  DocumentSummary,
  DocumentWithBlocks,
  GraphPathResult,
  GraphSnapshot,
  IndexStats,
  OptimizeReport,
  SearchResponse,
  SyncApplyReport,
  SyncCompactReport,
  SyncMergeReport,
  SyncStatus,
  TaskStatus,
  TaskViewItem,
  TrashItem,
  UnlinkedMention,
  VaultAnalytics,
  VaultOverview,
} from "../types/vault";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function authHeaders(): Record<string, string> {
  try {
    const token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("oxidevault_api_token")
        : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function httpGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function httpPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const vaultApi = {
  async getOverview(): Promise<VaultOverview> {
    if (isTauriRuntime()) return invoke("get_vault_overview");
    return httpGet("/api/overview");
  },

  async reindexVault(): Promise<IndexStats> {
    if (isTauriRuntime()) return invoke("reindex_vault");
    return httpPost("/api/reindex", {});
  },

  async listDocuments(): Promise<DocumentSummary[]> {
    if (isTauriRuntime()) return invoke("list_documents");
    return httpGet("/api/documents");
  },

  async getDocument(target: string): Promise<DocumentWithBlocks | null> {
    if (isTauriRuntime()) return invoke("get_document", { target });
    return httpGet(`/api/document?target=${encodeURIComponent(target)}`);
  },

  async saveMarkdownDocument(
    relPath: string,
    markdown: string,
  ): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("save_document", { relPath, markdown });
    }
    return httpPost("/api/document/save-markdown", { relPath, markdown });
  },

  async saveDocumentBlocks(
    relPath: string,
    document: Document,
    blocks: Block[],
  ): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("save_document_blocks", { relPath, document, blocks });
    }
    return httpPost("/api/document/save-blocks", { relPath, document, blocks });
  },

  async createDocument(
    relPath: string,
    title?: string,
  ): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("create_document", { relPath, title: title ?? null });
    }
    return httpPost("/api/document/create", { relPath, title: title ?? null });
  },

  async deleteDocument(relPath: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_document", { relPath });
      return;
    }
    await httpPost("/api/document/delete", { relPath });
  },

  async renameDocument(
    oldRelPath: string,
    newRelPath: string,
  ): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("rename_document", { oldRelPath, newRelPath });
    }
    return httpPost("/api/document/rename", { oldRelPath, newRelPath });
  },

  async materializeBlockId(relPath: string, blockId: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke("materialize_block_id", { relPath, blockId });
    }
    const res = await httpPost<{ blockId: string }>("/api/block/materialize", {
      relPath,
      blockId,
    });
    return res.blockId;
  },

  async getBlockById(blockId: string): Promise<BlockLookup | null> {
    if (isTauriRuntime()) return invoke("get_block_by_id", { blockId });
    return httpGet(`/api/block?id=${encodeURIComponent(blockId)}`);
  },

  async searchVault(query: string, limit = 25): Promise<SearchResponse> {
    if (isTauriRuntime()) return invoke("search_vault", { query, limit });
    return httpGet(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  },

  async getBacklinks(docId: string): Promise<BacklinkItem[]> {
    if (isTauriRuntime()) return invoke("get_backlinks", { docId });
    return httpGet(`/api/backlinks?docId=${encodeURIComponent(docId)}`);
  },

  async getTasks(status?: TaskStatus): Promise<TaskViewItem[]> {
    if (isTauriRuntime()) {
      return invoke("get_tasks", { statusFilter: status ?? null });
    }
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return httpGet(`/api/tasks${q}`);
  },

  async toggleTaskStatus(
    blockId: string,
    nextStatus: TaskStatus,
  ): Promise<TaskViewItem> {
    if (isTauriRuntime()) {
      return invoke("toggle_task_status", { blockId, nextStatus });
    }
    return httpPost("/api/tasks/toggle", { blockId, status: nextStatus });
  },

  async openDailyNote(date?: string): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("open_daily_note", { date: date ?? null });
    }
    return httpPost("/api/daily", { date: date ?? null });
  },

  async queryDatabase(query: DatabaseQuery): Promise<DatabaseQueryResult> {
    if (isTauriRuntime()) return invoke("query_database", { query });
    return httpPost("/api/database/query", query);
  },

  async getGraphSnapshot(includeTags = true): Promise<GraphSnapshot> {
    if (isTauriRuntime()) {
      return invoke("get_graph_snapshot", { includeTags });
    }
    return httpGet(`/api/graph?includeTags=${includeTags}`);
  },

  async findGraphPath(
    fromDocId: string,
    toDocId: string,
  ): Promise<GraphPathResult> {
    if (isTauriRuntime()) {
      return invoke("find_graph_path", { fromDocId, toDocId });
    }
    return httpGet(
      `/api/graph/path?from=${encodeURIComponent(fromDocId)}&to=${encodeURIComponent(toDocId)}`,
    );
  },

  async getCanvas(path: string): Promise<CanvasData> {
    if (isTauriRuntime()) return invoke("get_canvas", { relPath: path });
    return httpGet(`/api/canvas?path=${encodeURIComponent(path)}`);
  },

  async saveCanvas(canvas: CanvasData): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("save_canvas", { canvas });
      return;
    }
    await httpPost("/api/canvas/save", canvas);
  },

  async getSyncStatus(): Promise<SyncStatus> {
    if (isTauriRuntime()) return invoke("get_sync_status");
    return httpGet("/api/sync/status");
  },

  async simulateCrdtSync(): Promise<SyncMergeReport> {
    if (isTauriRuntime()) return invoke("simulate_crdt_sync");
    return httpPost("/api/sync/simulate", {});
  },

  async run100kBenchmark(): Promise<BenchmarkReport> {
    if (isTauriRuntime()) return invoke("run_100k_benchmark");
    return httpPost("/api/benchmark/100k", {});
  },

  async getRevision(): Promise<number> {
    if (isTauriRuntime()) return invoke("get_vault_revision");
    const res = await httpGet<{ revision: number }>("/api/revision");
    return res.revision;
  },

  async listTrash(): Promise<TrashItem[]> {
    if (isTauriRuntime()) return invoke("list_trash");
    return httpGet("/api/trash");
  },

  async restoreTrashItem(trashId: string): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("restore_trash_item", { trashId });
    }
    return httpPost("/api/trash/restore", { trashId });
  },

  async emptyTrash(): Promise<number> {
    if (isTauriRuntime()) return invoke("empty_trash");
    const res = await httpPost<{ removed: number }>("/api/trash/empty", {});
    return res.removed;
  },

  async listSnapshots(relPath: string): Promise<DocumentSnapshot[]> {
    if (isTauriRuntime()) return invoke("list_snapshots", { relPath });
    return httpGet(`/api/snapshots?path=${encodeURIComponent(relPath)}`);
  },

  async restoreSnapshot(snapshotId: number): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("restore_snapshot", { snapshotId });
    }
    return httpPost("/api/snapshots/restore", { snapshotId });
  },

  async getUnlinkedMentions(docId: string): Promise<UnlinkedMention[]> {
    if (isTauriRuntime()) return invoke("get_unlinked_mentions", { docId });
    return httpGet(`/api/unlinked-mentions?docId=${encodeURIComponent(docId)}`);
  },

  async linkUnlinkedMention(
    sourceDocPath: string,
    blockId: string,
    mentionText: string,
    targetTitle: string,
  ): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("link_unlinked_mention", {
        sourceDocPath,
        blockId,
        mentionText,
        targetTitle,
      });
      return;
    }
    await httpPost("/api/unlinked-mentions/link", {
      sourceDocPath,
      blockId,
      mentionText,
      targetTitle,
    });
  },

  async getVaultAnalytics(): Promise<VaultAnalytics> {
    if (isTauriRuntime()) return invoke("get_vault_analytics");
    return httpGet("/api/analytics");
  },

  async optimizeIndex(): Promise<OptimizeReport> {
    if (isTauriRuntime()) return invoke("optimize_index");
    return httpPost("/api/optimize", {});
  },

  async applyRemoteSync(): Promise<SyncApplyReport> {
    if (isTauriRuntime()) return invoke("apply_remote_sync");
    return httpPost("/api/sync/apply", {});
  },

  async compactSyncOplogs(): Promise<SyncCompactReport> {
    if (isTauriRuntime()) return invoke("compact_sync_oplogs");
    return httpPost("/api/sync/compact", {});
  },

  async updateDocumentProperty(
    relPath: string,
    key: string,
    value: string,
  ): Promise<DocumentWithBlocks> {
    if (isTauriRuntime()) {
      return invoke("update_document_property", { relPath, key, value });
    }
    return httpPost("/api/document/property", { relPath, key, value });
  },

  async createCanvas(relPath: string): Promise<CanvasData> {
    if (isTauriRuntime()) return invoke("create_canvas", { relPath });
    return httpPost("/api/canvas/create", { relPath });
  },

  async deleteCanvas(relPath: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_canvas", { relPath });
      return;
    }
    await httpPost("/api/canvas/delete", { relPath });
  },
};
