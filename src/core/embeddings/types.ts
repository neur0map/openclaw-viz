/* Types for vector embedding and semantic retrieval */

/* Node labels that get vector embeddings */
export const VECTORIZABLE_TYPES = [
  'Class',
  'Function',
  'Interface',
  'Method',
  'File',
] as const;

export type EmbeddableLabel = typeof VECTORIZABLE_TYPES[number];

/* Check if a label is eligible for vectorisation */
export const isEmbeddableLabel = (label: string): label is EmbeddableLabel =>
  VECTORIZABLE_TYPES.includes(label as EmbeddableLabel);

/* Embedding pipeline lifecycle phases */
export type EmbeddingPhase =
  | 'idle'
  | 'loading-model'
  | 'embedding'
  | 'indexing'
  | 'ready'
  | 'error';

/* Pipeline progress snapshot */
export interface EmbeddingProgress {
  phase: EmbeddingPhase;
  percent: number;
  modelDownloadPercent?: number;
  nodesProcessed?: number;
  totalNodes?: number;
  currentBatch?: number;
  totalBatches?: number;
  error?: string;
}

/* Embedding pipeline config */
export interface EmbeddingConfig {
  /** Model identifier for transformers.js */
  modelId: string;
  /** Number of nodes to embed in each batch */
  batchSize: number;
  /** Embedding vector dimensions */
  dimensions: number;
  /** Device to use for inference: 'webgpu' for GPU acceleration, 'wasm' for WASM-based CPU */
  device: 'webgpu' | 'wasm';
  /** Maximum characters of code snippet to include */
  maxSnippetLength: number;
}

/* Default config: compact arctic model, GPU-preferred */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  modelId: 'Snowflake/snowflake-arctic-embed-xs',
  batchSize: 16,
  dimensions: 384,
  device: 'webgpu',
  maxSnippetLength: 500,
};

/* Single semantic search result */
export interface SemanticSearchResult {
  nodeId: string;
  name: string;
  label: string;
  filePath: string;
  distance: number;
  startLine?: number;
  endLine?: number;
}

/* Lightweight node shape for embedding input */
export interface EmbeddableNode {
  id: string;
  name: string;
  label: string;
  filePath: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

/* Model download progress events from transformers.js */
export interface ModelProgress {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}
