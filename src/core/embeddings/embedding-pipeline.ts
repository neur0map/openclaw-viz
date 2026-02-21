/**
 * End-to-end vector embedding workflow: fetch eligible nodes from KuzuDB,
 * generate text representations, embed in batches, persist vectors,
 * and create the HNSW index for semantic search.
 */

import { initEmbedder, embedBatch, embedText, embeddingToArray, isEmbedderReady } from './embedder';
import { prepareBatchTexts, generateEmbeddingText } from './text-generator';
import {
  type EmbeddingProgress,
  type EmbeddingConfig,
  type EmbeddableNode,
  type SemanticSearchResult,
  type ModelProgress,
  DEFAULT_EMBEDDING_CONFIG,
  VECTORIZABLE_TYPES,
} from './types';

/** Progress callback. */
export type EmbeddingProgressCallback = (progress: EmbeddingProgress) => void;

/** Build a Cypher query for a node label; File nodes omit line-range columns. */
const buildNodeQuery = (nodeLabel: string): string => {
  if (nodeLabel === 'File') {
    return `
      MATCH (n:File)
      RETURN n.id AS id, n.name AS name, 'File' AS label,
             n.filePath AS filePath, n.content AS content
    `;
  }
  return `
    MATCH (n:${nodeLabel})
    RETURN n.id AS id, n.name AS name, '${nodeLabel}' AS label,
           n.filePath AS filePath, n.content AS content,
           n.startLine AS startLine, n.endLine AS endLine
  `;
};

/** Normalise a result row into an EmbeddableNode (supports named and positional formats). */
const rowToNode = (row: any): EmbeddableNode => ({
  id: row.id ?? row[0],
  name: row.name ?? row[1],
  label: row.label ?? row[2],
  filePath: row.filePath ?? row[3],
  content: row.content ?? row[4] ?? '',
  startLine: row.startLine ?? row[5],
  endLine: row.endLine ?? row[6],
});

/** Fetch all vectorisable nodes from KuzuDB. */
const fetchAllEmbeddableNodes = async (
  executeQuery: (cypher: string) => Promise<any[]>
): Promise<EmbeddableNode[]> => {
  const collected: EmbeddableNode[] = [];

  await Promise.all(
    VECTORIZABLE_TYPES.map(async (label) => {
      try {
        const cypher = buildNodeQuery(label);
        const rows = await executeQuery(cypher);
        rows.forEach((row) => collected.push(rowToNode(row)));
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn(`Query for ${label} nodes failed:`, err);
        }
      }
    })
  );

  return collected;
};

/** Store embedding vectors in the CodeEmbedding table (avoids COW on heavy node tables). */
const persistEmbeddings = async (
  executeWithReusedStatement: (
    cypher: string,
    paramsList: Array<Record<string, any>>
  ) => Promise<void>,
  entries: Array<{ id: string; embedding: number[] }>
): Promise<void> => {
  const statement = `CREATE (e:CodeEmbedding {nodeId: $nodeId, embedding: $embedding})`;
  const params = entries.map((entry) => ({
    nodeId: entry.id,
    embedding: entry.embedding,
  }));
  await executeWithReusedStatement(statement, params);
};

/** Create the cosine vector index if it does not already exist. */
const ensureVectorIndex = async (
  executeQuery: (cypher: string) => Promise<any[]>
): Promise<void> => {
  try {
    await executeQuery(
      `CALL CREATE_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 'embedding', metric := 'cosine')`
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('Could not create vector index (may already exist):', err);
    }
  }
};

/** Emit a progress update. */
const emitProgress = (
  cb: EmbeddingProgressCallback,
  payload: EmbeddingProgress
): void => {
  cb(payload);
};

/** Run the full embedding pipeline against KuzuDB. */
export const runEmbeddingPipeline = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  executeWithReusedStatement: (cypher: string, paramsList: Array<Record<string, any>>) => Promise<void>,
  onProgress: EmbeddingProgressCallback,
  config: Partial<EmbeddingConfig> = {}
): Promise<void> => {
  const cfg = { ...DEFAULT_EMBEDDING_CONFIG, ...config };

  try {
    // Phase 1 -- load model
    emitProgress(onProgress, {
      phase: 'loading-model',
      percent: 0,
      modelDownloadPercent: 0,
    });

    await initEmbedder((mp: ModelProgress) => {
      const pct = mp.progress ?? 0;
      emitProgress(onProgress, {
        phase: 'loading-model',
        percent: Math.round(pct * 0.2),
        modelDownloadPercent: pct,
      });
    }, cfg);

    emitProgress(onProgress, {
      phase: 'loading-model',
      percent: 20,
      modelDownloadPercent: 100,
    });

    if (import.meta.env.DEV) {
      console.log('Querying embeddable nodes...');
    }

    // Phase 2 -- fetch nodes
    const nodes = await fetchAllEmbeddableNodes(executeQuery);
    const nodeCount = nodes.length;

    if (import.meta.env.DEV) {
      console.log(`Found ${nodeCount} embeddable nodes`);
    }

    if (nodeCount === 0) {
      emitProgress(onProgress, {
        phase: 'ready',
        percent: 100,
        nodesProcessed: 0,
        totalNodes: 0,
      });
      return;
    }

    // Phase 3 -- batch embed
    const chunkSize = cfg.batchSize;
    const numChunks = Math.ceil(nodeCount / chunkSize);
    let completed = 0;

    emitProgress(onProgress, {
      phase: 'embedding',
      percent: 20,
      nodesProcessed: 0,
      totalNodes: nodeCount,
      currentBatch: 0,
      totalBatches: numChunks,
    });

    let chunkIdx = 0;
    while (chunkIdx < numChunks) {
      const lo = chunkIdx * chunkSize;
      const hi = Math.min(lo + chunkSize, nodeCount);
      const chunk = nodes.slice(lo, hi);

      const texts = prepareBatchTexts(chunk, cfg);
      const vectors = await embedBatch(texts);

      const entries = chunk.map((nd, idx) => ({
        id: nd.id,
        embedding: embeddingToArray(vectors[idx]),
      }));

      await persistEmbeddings(executeWithReusedStatement, entries);

      completed += chunk.length;
      const phasePct = 20 + (completed / nodeCount) * 70;

      emitProgress(onProgress, {
        phase: 'embedding',
        percent: Math.round(phasePct),
        nodesProcessed: completed,
        totalNodes: nodeCount,
        currentBatch: chunkIdx + 1,
        totalBatches: numChunks,
      });

      chunkIdx++;
    }

    // Phase 4 -- index vectors
    emitProgress(onProgress, {
      phase: 'indexing',
      percent: 90,
      nodesProcessed: nodeCount,
      totalNodes: nodeCount,
    });

    if (import.meta.env.DEV) {
      console.log('Creating vector index...');
    }

    await ensureVectorIndex(executeQuery);

    emitProgress(onProgress, {
      phase: 'ready',
      percent: 100,
      nodesProcessed: nodeCount,
      totalNodes: nodeCount,
    });

    if (import.meta.env.DEV) {
      console.log('Embedding pipeline complete');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';

    if (import.meta.env.DEV) {
      console.error('Embedding pipeline error:', err);
    }

    emitProgress(onProgress, {
      phase: 'error',
      percent: 0,
      error: msg,
    });

    throw err;
  }
};

/** Semantic search via the CodeEmbedding vector index. */
export const semanticSearch = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  query: string,
  k: number = 10,
  maxDistance: number = 0.5
): Promise<SemanticSearchResult[]> => {
  if (!isEmbedderReady()) {
    throw new Error('Vector model unavailable. Execute the embedding pipeline before searching.');
  }

  const qVec = embeddingToArray(await embedText(query));
  const vecLiteral = `[${qVec.join(',')}]`;

  const vectorCypher = `
    CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx',
      CAST(${vecLiteral} AS FLOAT[384]), ${k})
    YIELD node AS emb, distance
    WITH emb, distance
    WHERE distance < ${maxDistance}
    RETURN emb.nodeId AS nodeId, distance
    ORDER BY distance
  `;

  const embHits = await executeQuery(vectorCypher);

  if (embHits.length === 0) {
    return [];
  }

  // Fetch metadata for each hit
  const output: SemanticSearchResult[] = [];

  await Promise.all(
    embHits.map(async (hit) => {
      const nid: string = hit.nodeId ?? hit[0];
      const dist: number = hit.distance ?? hit[1];

      const colonPos = nid.indexOf(':');
      const nodeLabel = colonPos > 0 ? nid.substring(0, colonPos) : 'Unknown';
      const escapedId = nid.replace(/'/g, "''");

      try {
        const metaCypher =
          nodeLabel === 'File'
            ? `MATCH (n:File {id: '${escapedId}'}) RETURN n.name AS name, n.filePath AS filePath`
            : `MATCH (n:${nodeLabel} {id: '${escapedId}'}) RETURN n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine`;

        const metaRows = await executeQuery(metaCypher);
        if (metaRows.length > 0) {
          const mr = metaRows[0];
          output.push({
            nodeId: nid,
            name: mr.name ?? mr[0] ?? '',
            label: nodeLabel,
            filePath: mr.filePath ?? mr[1] ?? '',
            distance: dist,
            startLine: nodeLabel !== 'File' ? (mr.startLine ?? mr[2]) : undefined,
            endLine: nodeLabel !== 'File' ? (mr.endLine ?? mr[3]) : undefined,
          });
        }
      } catch {
        // missing table -- skip
      }
    })
  );

  // Re-sort by distance after parallel metadata resolution
  output.sort((a, b) => a.distance - b.distance);

  return output;
};

/** Semantic search returning flattened results with metadata. */
export const semanticSearchWithContext = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  query: string,
  k: number = 5,
  _hops: number = 1
): Promise<any[]> => {
  const hits = await semanticSearch(executeQuery, query, k, 0.5);

  return hits.map((h) => ({
    matchId: h.nodeId,
    matchName: h.name,
    matchLabel: h.label,
    matchPath: h.filePath,
    distance: h.distance,
    connectedId: null,
    connectedName: null,
    connectedLabel: null,
    relationType: null,
  }));
};
