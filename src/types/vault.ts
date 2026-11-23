export type BlockType =
  | "paragraph"
  | "heading"
  | "listItem"
  | "taskItem"
  | "codeBlock"
  | "quote"
  | "callout"
  | "divider";

export type TaskStatus = "TODO" | "DOING" | "DONE" | "CANCELED";

export type LinkType =
  | "wikiLink"
  | "blockRef"
  | "embed"
  | "tag"
  | "propertyRel";

export interface TaskMetadata {
  status: TaskStatus;
  priority: number | null;
  scheduledAt: string | null;
  deadlineAt: string | null;
  recurrence: string | null;
}

export interface Block {
  id: string;
  docId: string;
  parentBlockId: string | null;
  depth: number;
  sortOrder: number;
  blockType: BlockType;
  headingLevel: number | null;
  codeLang: string | null;
  hasExplicitId: boolean;
  rawContent: string;
  plainText: string;
  properties: Record<string, string>;
  tags: string[];
  collapsed: boolean;
  task: TaskMetadata | null;
  updatedAt: number;
}

export interface Document {
  id: string;
  path: string;
  title: string;
  blake3Hash: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DocumentSummary {
  id: string;
  path: string;
  title: string;
  blake3Hash: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  blockCount: number;
  taskCount: number;
  updatedAt: number;
}

export interface DocumentWithBlocks {
  document: Document;
  blocks: Block[];
  rawMarkdown: string;
}

export interface BlockLookup {
  block: Block;
  docPath: string;
  docTitle: string;
}

export interface BacklinkItem {
  sourceDocId: string;
  sourceDocPath: string;
  sourceDocTitle: string;
  sourceBlockId: string;
  sourcePlainText: string;
  linkType: LinkType;
  targetRaw: string;
}

export interface SearchResult {
  blockId: string;
  docId: string;
  docPath: string;
  docTitle: string;
  snippet: string;
  plainText: string;
  bm25Score: number;
}

export interface SearchResponse {
  query: string;
  elapsedUs: number;
  totalHits: number;
  results: SearchResult[];
}

export interface TaskViewItem {
  blockId: string;
  docId: string;
  docPath: string;
  docTitle: string;
  content: string;
  status: TaskStatus;
  priority: number | null;
  scheduledAt: string | null;
  deadlineAt: string | null;
  recurrence: string | null;
  tags: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  path: string | null;
  nodeKind: "document" | "tag" | "unresolved";
  x: number;
  y: number;
  degree: number;
  centrality: number;
  clusterId: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  linkType: LinkType;
  weight: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  computedInUs: number;
  clusterCount: number;
}

export interface GraphPathResult {
  found: boolean;
  pathNodeIds: string[];
  pathLabels: string[];
  hops: number;
}

export interface CanvasNode {
  id: string;
  nodeType: "text" | "doc_embed" | "block_embed" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string | null;
  text: string | null;
  refDocPath: string | null;
  refBlockId: string | null;
  color: string | null;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: string | null;
  toSide: string | null;
  label: string | null;
  color: string | null;
}

export interface CanvasData {
  path: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface PropertyFilter {
  key: string;
  operator: "eq" | "neq" | "contains";
  value: string;
}

export interface DatabaseQuery {
  tag: string | null;
  filters: PropertyFilter[];
  sortBy: string | null;
  sortDesc: boolean;
}

export interface DatabaseRow {
  id: string;
  itemKind: string;
  docId: string;
  docPath: string;
  title: string;
  tags: string[];
  properties: Record<string, string>;
  taskStatus: TaskStatus | null;
  updatedAt: number;
}

export interface DatabaseQueryResult {
  elapsedUs: number;
  columns: string[];
  rows: DatabaseRow[];
}

export interface DeviceInfo {
  deviceId: string;
  displayName: string;
  lastSeenTs: number;
  opCount: number;
}

export interface SyncStatus {
  deviceId: string;
  syncDir: string;
  oplogFiles: string[];
  totalOps: number;
  conflictFilesDetected: number;
  lastSyncTs: number;
  devices?: DeviceInfo[];
}

export interface SyncMergeReport {
  deviceAFile: string;
  deviceBFile: string;
  targetDocPath: string;
  baseText: string;
  deviceAEdit: string;
  deviceBEdit: string;
  mergedResult: string;
  conflictCopiesCreated: number;
  opsApplied: number;
  elapsedUs: number;
}

export interface IndexStats {
  filesScanned: number;
  filesReindexed: number;
  filesSkippedUnchanged: number;
  filesDeleted: number;
  totalDocuments: number;
  totalBlocks: number;
  totalLinks: number;
  totalTasks: number;
  elapsedMs: number;
}

export interface VaultOverview {
  vaultPath: string;
  dbPath: string;
  totalDocuments: number;
  totalBlocks: number;
  totalLinks: number;
  totalTasks: number;
  openTasks: number;
  dbSizeBytes: number;
  canvasFiles: string[];
  syncStatus: SyncStatus;
  revision: number;
  trashCount: number;
}

export interface TrashItem {
  trashId: string;
  originalPath: string;
  title: string;
  deletedAt: number;
  sizeBytes: number;
}

export interface DocumentSnapshot {
  id: number;
  docPath: string;
  blake3Hash: string;
  content: string;
  createdAt: number;
  byteLen: number;
}

export interface UnlinkedMention {
  sourceDocId: string;
  sourceDocPath: string;
  sourceDocTitle: string;
  sourceBlockId: string;
  sourcePlainText: string;
  matchedTerm: string;
}

export interface BrokenLinkInfo {
  targetRaw: string;
  referenceCount: number;
  sourceDocs: string[];
}

export interface HubDocInfo {
  docId: string;
  path: string;
  title: string;
  degree: number;
  wordCount: number;
}

export interface VaultAnalytics {
  totalDocuments: number;
  totalBlocks: number;
  totalWords: number;
  totalChars: number;
  estimatedReadingMinutes: number;
  dbSizeBytes: number;
  orphanDocuments: DocumentSummary[];
  brokenLinks: BrokenLinkInfo[];
  topHubs: HubDocInfo[];
  largestDocuments: HubDocInfo[];
}

export interface OptimizeReport {
  elapsedUs: number;
  dbSizeBeforeBytes: number;
  dbSizeAfterBytes: number;
}

export interface SyncApplyReport {
  opsScanned: number;
  opsApplied: number;
  docsUpdated: string[];
  elapsedUs: number;
}

export interface SyncCompactReport {
  filesBefore: number;
  filesAfter: number;
  opsCompacted: number;
  bytesSaved: number;
}

export interface BenchmarkReport {
  fileCount: number;
  blockCount: number;
  linkCount: number;
  taskCount: number;
  generationMs: number;
  coldIndexMs: number;
  blocksPerSec: number;
  deltaSync1FileMs: number;
  deltaFilesSkipped: number;
  ftsSearchUs: number;
  ftsHits: number;
  graphBuildLayoutMs: number;
  dbSizeMb: number;
}
