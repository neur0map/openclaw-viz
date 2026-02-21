import * as Comlink from 'comlink';
import type { IndexingProgress, SerializableIndexingResult } from '../types/pipeline';
import type { FileEntry } from '../services/zip';
import type { EmbeddingProgress, SemanticSearchResult } from '../core/embeddings/types';
import type { ProviderConfig, AgentStreamChunk } from '../core/llm/types';
import type { ClusterEnrichment, ClusterMemberInfo } from '../core/ingestion/cluster-enricher';
import type { CommunityNode } from '../core/ingestion/community-processor';
import type { AgentMessage } from '../core/llm/agent';
import type { SearchHit } from '../core/search';
import type { EmbeddingProgressCallback } from '../core/embeddings/embedding-pipeline';
import { serializeIndexingResult, IndexingResult } from '../types/pipeline';

let pipelineModule: typeof import('../core/ingestion/pipeline') | null = null;
const getPipeline = async () => {
  if (!pipelineModule) pipelineModule = await import('../core/ingestion/pipeline');
  return pipelineModule;
};

let agentModule: typeof import('../core/llm/agent') | null = null;
const getAgent = async () => {
  if (!agentModule) agentModule = await import('../core/llm/agent');
  return agentModule;
};

let embeddingModule: typeof import('../core/embeddings/embedding-pipeline') | null = null;
const getEmbedding = async () => {
  if (!embeddingModule) embeddingModule = await import('../core/embeddings/embedding-pipeline');
  return embeddingModule;
};

let embedderModule: typeof import('../core/embeddings/embedder') | null = null;
const getEmbedder = async () => {
  if (!embedderModule) embedderModule = await import('../core/embeddings/embedder');
  return embedderModule;
};

let searchModule: typeof import('../core/search') | null = null;
const getSearch = async () => {
  if (!searchModule) searchModule = await import('../core/search');
  return searchModule;
};

let contextModule: typeof import('../core/llm/context-builder') | null = null;
const getContext = async () => {
  if (!contextModule) contextModule = await import('../core/llm/context-builder');
  return contextModule;
};

let enricherModule: typeof import('../core/ingestion/cluster-enricher') | null = null;
const getEnricher = async () => {
  if (!enricherModule) enricherModule = await import('../core/ingestion/cluster-enricher');
  return enricherModule;
};

let langcoreModule: typeof import('@langchain/core/messages') | null = null;
const getLangCore = async () => {
  if (!langcoreModule) langcoreModule = await import('@langchain/core/messages');
  return langcoreModule;
};

// Kuzu requires SharedArrayBuffer; lazy-load to degrade gracefully
let kuzuAdapter: typeof import('../core/kuzu/kuzu-adapter') | null = null;
const getKuzuAdapter = async () => {
  if (!kuzuAdapter) {
    kuzuAdapter = await import('../core/kuzu/kuzu-adapter');
  }
  return kuzuAdapter;
};

// Snapshot module (lazy loaded)
let snapshotModule: typeof import('../core/snapshot') | null = null;
const getSnapshot = async () => {
  if (!snapshotModule) snapshotModule = await import('../core/snapshot');
  return snapshotModule;
};

// Embedding state
let embeddingProgress: EmbeddingProgress | null = null;
let isEmbeddingComplete = false;

// File contents state - stores full file contents for grep/read tools
let storedFileContents: Map<string, string> = new Map();

// Project path state (for snapshot persistence)
let projectPath: string | null = null;

// Agent state
let currentAgent: any | null = null;
let currentProviderConfig: ProviderConfig | null = null;
let currentGraphResult: IndexingResult | null = null;

let pendingEnrichmentConfig: ProviderConfig | null = null;
let enrichmentCancelled = false;

// Chat cancellation flag
let chatCancelled = false;

async function warmEmbeddingModel(): Promise<void> {
  try {
    const { initEmbedder } = await getEmbedder();
    try {
      await initEmbedder(undefined, {}, 'webgpu');
    } catch {
      await initEmbedder(undefined, {}, 'wasm');
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[prowl:embedding] Model warm-up failed:', err);
    }
  }
}

const workerApi = {
  async runPipeline(
    file: File,
    onProgress: (progress: IndexingProgress) => void,
    clusteringConfig?: ProviderConfig
  ): Promise<SerializableIndexingResult> {
    const { runIngestionPipeline } = await getPipeline();
    const { buildBM25Index } = await getSearch();
    const result = await runIngestionPipeline(file, onProgress);
    currentGraphResult = result;

    // Store file contents for grep/read tools (full content, not truncated)
    storedFileContents = result.fileContents;

    // Build BM25 index for keyword search (instant, ~100ms)
    buildBM25Index(storedFileContents);
    
    // Load graph into KuzuDB for querying (optional - gracefully degrades)
    try {
      onProgress({
        phase: 'complete',
        percent: 98,
        message: 'Indexing graph database...',
        stats: {
          filesProcessed: result.graph.nodeCount,
          totalFiles: result.graph.nodeCount,
          nodesCreated: result.graph.nodeCount,
        },
      });
      
      const kuzu = await getKuzuAdapter();
      await kuzu.loadGraphToKuzu(result.graph, result.fileContents);
      
    } catch {
      // KuzuDB is optional - silently continue without it
    }
    
    // Store clustering config for background enrichment (runs after graph loads)
    if (clusteringConfig) {
      pendingEnrichmentConfig = clusteringConfig;
    }
    
    return serializeIndexingResult(result);
  },

  async runQuery(cypher: string): Promise<any[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Load a project before querying.');
    }
    return kuzu.executeQuery(cypher);
  },

  async isReady(): Promise<boolean> {
    try {
      const kuzu = await getKuzuAdapter();
      return kuzu.isKuzuReady();
    } catch {
      return false;
    }
  },

  async getStats(): Promise<{ nodes: number; edges: number }> {
    try {
      const kuzu = await getKuzuAdapter();
      return kuzu.getKuzuStats();
    } catch {
      return { nodes: 0, edges: 0 };
    }
  },

  async runPipelineFromFiles(
    files: FileEntry[],
    onProgress: (progress: IndexingProgress) => void,
    clusteringConfig?: ProviderConfig
  ): Promise<SerializableIndexingResult> {
    onProgress({
      phase: 'extracting',
      percent: 15,
      message: 'Files ready',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: 0 },
    });

    const pipeline = await getPipeline();
    const { buildBM25Index } = await getSearch();
    const result = await pipeline.runPipelineFromFiles(files, onProgress);
    currentGraphResult = result;

    // Store file contents for grep/read tools (full content, not truncated)
    storedFileContents = result.fileContents;

    // Build BM25 index for keyword search (instant, ~100ms)
    buildBM25Index(storedFileContents);
    
    // Load graph into KuzuDB for querying (optional - gracefully degrades)
    try {
      onProgress({
        phase: 'complete',
        percent: 98,
        message: 'Indexing graph database...',
        stats: {
          filesProcessed: result.graph.nodeCount,
          totalFiles: result.graph.nodeCount,
          nodesCreated: result.graph.nodeCount,
        },
      });
      
      const kuzu = await getKuzuAdapter();
      await kuzu.loadGraphToKuzu(result.graph, result.fileContents);
      
    } catch {
      // KuzuDB is optional - silently continue without it
    }
    
    // Store clustering config for background enrichment (runs after graph loads)
    if (clusteringConfig) {
      pendingEnrichmentConfig = clusteringConfig;
    }
    
    return serializeIndexingResult(result);
  },

  async startEmbeddingPipeline(
    onProgress: (progress: EmbeddingProgress) => void,
    forceDevice?: 'webgpu' | 'wasm'
  ): Promise<void> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Load a project before querying.');
    }

    embeddingProgress = null;
    isEmbeddingComplete = false;

    const progressCallback: EmbeddingProgressCallback = (progress) => {
      embeddingProgress = progress;
      if (progress.phase === 'ready') {
        isEmbeddingComplete = true;
      }
      onProgress(progress);
    };

    const { runEmbeddingPipeline } = await getEmbedding();
    await runEmbeddingPipeline(
      kuzu.executeQuery,
      kuzu.executeWithReusedStatement,
      progressCallback,
      forceDevice ? { device: forceDevice } : {}
    );
  },

  async startBackgroundEnrichment(
    onProgress?: (current: number, total: number) => void
  ): Promise<{ enriched: number; skipped: boolean }> {
    if (!pendingEnrichmentConfig) {
      return { enriched: 0, skipped: true };
    }
    
    try {
      await workerApi.enrichCommunities(
        pendingEnrichmentConfig,
        onProgress ?? (() => {})
      );
      pendingEnrichmentConfig = null; // Clear after running
      return { enriched: 1, skipped: false };
    } catch (err) {
      console.error('[prowl:worker] background enrichment failed:', err);
      pendingEnrichmentConfig = null;
      return { enriched: 0, skipped: false };
    }
  },

  async cancelEnrichment(): Promise<void> {
    enrichmentCancelled = true;
    pendingEnrichmentConfig = null;
  },

  async semanticSearch(
    query: string,
    k: number = 10,
    maxDistance: number = 0.5
  ): Promise<SemanticSearchResult[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Load a project before querying.');
    }
    if (!isEmbeddingComplete) {
      throw new Error('Vector index not ready yet.');
    }

    const { semanticSearch: doSemanticSearch } = await getEmbedding();
    return doSemanticSearch(kuzu.executeQuery, query, k, maxDistance);
  },

  async semanticSearchWithContext(
    query: string,
    k: number = 5,
    hops: number = 2
  ): Promise<any[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Load a project before querying.');
    }
    if (!isEmbeddingComplete) {
      throw new Error('Vector index not ready yet.');
    }

    const { semanticSearchWithContext: doSemanticSearchWithContext } = await getEmbedding();
    return doSemanticSearchWithContext(kuzu.executeQuery, query, k, hops);
  },

  async hybridSearch(
    query: string,
    k: number = 10
  ): Promise<SearchHit[]> {
    const search = await getSearch();
    if (!search.isBM25Ready()) {
      throw new Error('Index not built yet. Load a project first.');
    }

    const bm25Results = search.searchBM25(query, k * 3);

    let semanticResults: SemanticSearchResult[] = [];
    if (isEmbeddingComplete) {
      try {
        const kuzu = await getKuzuAdapter();
        if (kuzu.isKuzuReady()) {
          const { semanticSearch: doSemanticSearch } = await getEmbedding();
          semanticResults = await doSemanticSearch(kuzu.executeQuery, query, k * 3, 0.5);
        }
      } catch {
        // Semantic search failed, continue with BM25 only
      }
    }

    return search.mergeWithRRF(bm25Results, semanticResults, k);
  },

  async isBM25Ready(): Promise<boolean> {
    const search = await getSearch();
    return search.isBM25Ready();
  },

  async getBM25Stats(): Promise<{ documentCount: number; termCount: number }> {
    const search = await getSearch();
    return search.getBM25Stats();
  },

  async isEmbeddingModelReady(): Promise<boolean> {
    const { isEmbedderReady } = await getEmbedder();
    return isEmbedderReady();
  },

  isEmbeddingComplete(): boolean {
    return isEmbeddingComplete;
  },

  getEmbeddingProgress(): EmbeddingProgress | null {
    return embeddingProgress;
  },

  async disposeEmbeddingModel(): Promise<void> {
    const { disposeEmbedder } = await getEmbedder();
    await disposeEmbedder();
    isEmbeddingComplete = false;
    embeddingProgress = null;
  },

  async testArrayParams(): Promise<{ success: boolean; error?: string }> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      return { success: false, error: 'Database not ready' };
    }
    return kuzu.testArrayParams();
  },

  async initializeAgent(config: ProviderConfig, projectName?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const kuzu = await getKuzuAdapter();
      if (!kuzu.isKuzuReady()) {
        return { success: false, error: 'Load a project before querying.' };
      }

      const { buildCodeAgent } = await getAgent();
      const embedding = await getEmbedding();
      const search = await getSearch();
      const context = await getContext();

      const semanticSearchWrapper = async (query: string, k?: number, maxDistance?: number) => {
        if (!isEmbeddingComplete) {
          throw new Error('Embeddings not ready');
        }
        return embedding.semanticSearch(kuzu.executeQuery, query, k, maxDistance);
      };

      const contextualVectorSearch = async (query: string, k?: number, hops?: number) => {
        if (!isEmbeddingComplete) {
          throw new Error('Embeddings not ready');
        }
        return embedding.semanticSearchWithContext(kuzu.executeQuery, query, k, hops);
      };

      const hybridSearchWrapper = async (query: string, k?: number) => {
        const bm25Results = search.searchBM25(query, (k ?? 10) * 3);

        let semanticResults: any[] = [];
        if (isEmbeddingComplete) {
          try {
            semanticResults = await embedding.semanticSearch(kuzu.executeQuery, query, (k ?? 10) * 3, 0.5);
          } catch {
            // Semantic search failed, continue with BM25 only
          }
        }

        return search.mergeWithRRF(bm25Results, semanticResults, k ?? 10);
      };

      const resolvedProjectName = projectName || 'project';
      if (import.meta.env.DEV) {
      }

      let codebaseContext;
      try {
        codebaseContext = await context.buildProjectContext(kuzu.executeQuery, resolvedProjectName);
      } catch (err) {
        console.warn('Context build skipped:', err);
      }

      currentAgent = await buildCodeAgent(
        config,
        kuzu.executeQuery,
        semanticSearchWrapper,
        contextualVectorSearch,
        hybridSearchWrapper,
        () => isEmbeddingComplete,
        () => search.isBM25Ready(),
        storedFileContents,
        codebaseContext
      );
      currentProviderConfig = config;


      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (import.meta.env.DEV) {
        console.error('[prowl:worker] agent initialization failed:', error);
      }
      return { success: false, error: message };
    }
  },

  isAgentReady(): boolean {
    return currentAgent !== null;
  },

  getAgentProvider(): { provider: string; model: string } | null {
    if (!currentProviderConfig) return null;
    return {
      provider: currentProviderConfig.provider,
      model: currentProviderConfig.model,
    };
  },

  async chatStream(
    messages: AgentMessage[],
    onChunk: (chunk: AgentStreamChunk) => void
  ): Promise<void> {
    if (!currentAgent) {
      onChunk({ type: 'error', error: 'No LLM provider configured.' });
      return;
    }

    chatCancelled = false;

    try {
      const { streamAgentResponse } = await getAgent();
      for await (const chunk of streamAgentResponse(currentAgent, messages)) {
        if (chatCancelled) {
          onChunk({ type: 'done' });
          break;
        }
        onChunk(chunk);
      }
    } catch (error) {
      if (chatCancelled) {
        // Swallow errors from cancellation
        onChunk({ type: 'done' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      onChunk({ type: 'error', error: message });
    }
  },

  stopChat(): void {
    chatCancelled = true;
  },

  disposeAgent(): void {
    currentAgent = null;
    currentProviderConfig = null;
  },

  setProjectPath(path: string | null): void {
    projectPath = path;
  },

  async loadSnapshot(
    path: string,
    onProgress: (progress: IndexingProgress) => void,
  ): Promise<(SerializableIndexingResult & { hasEmbeddings: boolean }) | null> {
    const prowl = (globalThis as any).window?.prowl ?? (globalThis as any).prowl;
    if (!prowl?.snapshot) return null;

    try {
      onProgress({ phase: 'extracting', percent: 5, message: 'Reading snapshot...' });

      // Read snapshot data
      const data = await prowl.snapshot.read(path);
      if (!data) return null;

      // Read meta and verify HMAC
      onProgress({ phase: 'extracting', percent: 10, message: 'Verifying integrity...' });
      const meta = await prowl.snapshot.readMeta(path) as any;
      if (!meta?.hmac) return null;

      const valid = await prowl.snapshot.verify(data, meta.hmac);
      if (!valid) {
        console.warn('[prowl:snapshot] HMAC verification failed — full re-index needed');
        return null;
      }

      // Check format version compatibility
      if (meta.formatVersion != null) {
        const { SNAPSHOT_FORMAT_VERSION } = await getSnapshot();
        if (meta.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
          console.warn(`[prowl:snapshot] Format version mismatch: ${meta.formatVersion} vs ${SNAPSHOT_FORMAT_VERSION} — full re-index`);
          return null;
        }
      }

      // Check app version compatibility
      const prowlVersion = (import.meta.env.VITE_APP_VERSION as string) || 'unknown';
      if (meta.prowlVersion && prowlVersion !== 'unknown' && meta.prowlVersion !== prowlVersion) {
        console.warn(`[prowl:snapshot] Version mismatch: ${meta.prowlVersion} vs ${prowlVersion} — full re-index`);
        return null;
      }

      // Deserialize
      onProgress({ phase: 'structure', percent: 20, message: 'Deserializing snapshot...' });
      const { deserializeSnapshot } = await getSnapshot();
      const payload = await deserializeSnapshot(data);

      // Restore graph
      onProgress({ phase: 'parsing', percent: 40, message: 'Restoring graph...' });
      const { restoreGraphFromPayload, restoreFileContents } = await getSnapshot();
      const graph = restoreGraphFromPayload(payload);
      const fileContentsMap = restoreFileContents(payload);

      // Set worker state
      storedFileContents = fileContentsMap;
      currentGraphResult = {
        graph,
        fileContents: fileContentsMap,
        communityResult: { communities: [], memberships: [], stats: { totalCommunities: 0, modularity: 0, nodesProcessed: 0 } },
        processResult: { processes: [], steps: [], stats: { totalProcesses: 0, crossCommunityCount: 0, avgStepCount: 0, entryPointsFound: 0 } },
      };
      projectPath = path;

      // Rebuild BM25 from file contents (fast, ~100ms)
      onProgress({ phase: 'imports', percent: 60, message: 'Rebuilding search index...' });
      const { buildBM25Index } = await getSearch();
      buildBM25Index(storedFileContents);

      // Restore KuzuDB
      onProgress({ phase: 'calls', percent: 70, message: 'Restoring graph database...' });
      try {
        const { restoreKuzuFromSnapshot } = await import('../core/snapshot/kuzu-restorer');
        await restoreKuzuFromSnapshot(payload);
      } catch (err) {
        console.warn('[prowl:snapshot] KuzuDB restore failed (non-fatal):', err);
      }

      // Set embedding state and warm model in background
      const hasEmbeddings = payload.embeddings.length > 0;
      if (hasEmbeddings) {
        isEmbeddingComplete = true;
        // Non-blocking: warm the embedding model so semantic search has zero cold-start
        warmEmbeddingModel().catch(console.warn);
      }

      onProgress({
        phase: 'complete',
        percent: 100,
        message: `Loaded from cache! ${payload.meta.nodeCount} nodes, ${payload.meta.relationshipCount} edges`,
        stats: {
          filesProcessed: payload.meta.fileCount,
          totalFiles: payload.meta.fileCount,
          nodesCreated: payload.meta.nodeCount,
        },
      });

      return {
        nodes: payload.nodes,
        relationships: payload.relationships,
        fileContents: payload.fileContents,
        hasEmbeddings,
      };
    } catch (err) {
      console.warn('[prowl:snapshot] Load failed:', err);
      return null;
    }
  },

  async incrementalUpdate(
    diff: { added: string[]; modified: string[]; deleted: string[]; isGitRepo: boolean },
    folderPath: string,
    onProgress: (progress: IndexingProgress) => void,
  ): Promise<SerializableIndexingResult | null> {
    if (!currentGraphResult) return null;

    const prowl = (globalThis as any).window?.prowl ?? (globalThis as any).prowl;
    if (!prowl?.fs?.readFile) return null;

    try {
      // Read changed/added files from disk
      const newFileContents = new Map<string, string>();
      const filesToRead = [...diff.added, ...diff.modified];
      for (const filePath of filesToRead) {
        try {
          const content = await prowl.fs.readFile(`${folderPath}/${filePath}`);
          newFileContents.set(filePath, content);
        } catch {
          // File might be binary or unreadable — skip
        }
      }

      const { applyIncrementalUpdate } = await import('../core/snapshot/incremental-updater');
      const result = await applyIncrementalUpdate(
        diff,
        newFileContents,
        currentGraphResult.graph,
        currentGraphResult.fileContents,
        onProgress,
      );

      // Update worker state
      currentGraphResult = result;
      storedFileContents = result.fileContents;

      // Rebuild BM25
      const { buildBM25Index } = await getSearch();
      buildBM25Index(storedFileContents);

      // Reload KuzuDB
      try {
        const kuzu = await getKuzuAdapter();
        await kuzu.loadGraphToKuzu(result.graph, result.fileContents);
      } catch {
        // KuzuDB is optional
      }

      return serializeIndexingResult(result);
    } catch (err) {
      console.warn('[prowl:snapshot] Incremental update failed:', err);
      return null;
    }
  },

  async saveSnapshot(path: string): Promise<{ success: boolean; size: number }> {
    if (!currentGraphResult) {
      return { success: false, size: 0 };
    }

    const { saveProjectSnapshot } = await getSnapshot();
    let kuzuQueryFn: ((cypher: string) => Promise<any[]>) | undefined;

    try {
      const kuzu = await getKuzuAdapter();
      if (kuzu.isKuzuReady()) {
        kuzuQueryFn = kuzu.executeQuery;
      }
    } catch { /* no kuzu */ }

    // Get prowl version from package.json (injected by Vite as env)
    const prowlVersion = (import.meta.env.VITE_APP_VERSION as string) || 'unknown';

    const projectName = path.split('/').filter(Boolean).pop() || 'project';

    const result = await saveProjectSnapshot(
      path,
      currentGraphResult.graph,
      currentGraphResult.fileContents,
      projectName,
      prowlVersion,
      kuzuQueryFn,
    );

    return { success: result.success, size: result.size };
  },

  async enrichCommunities(
    providerConfig: ProviderConfig,
    onProgress: (current: number, total: number) => void
  ): Promise<{ enrichments: Record<string, ClusterEnrichment>, tokensUsed: number }> {
    if (!currentGraphResult) {
      throw new Error('No project loaded.');
    }

    const { graph } = currentGraphResult;
    
    // Filter for community nodes
    const communityNodes = graph.nodes
      .filter(n => n.label === 'Community')
      .map(n => ({
        id: n.id,
        label: 'Community',
        heuristicLabel: n.properties.heuristicLabel,
        cohesion: n.properties.cohesion,
        symbolCount: n.properties.symbolCount
      } as CommunityNode));

    if (communityNodes.length === 0) {
      return { enrichments: {}, tokensUsed: 0 };
    }

    // Build member map: CommunityID -> Member Info
    const memberMap = new Map<string, ClusterMemberInfo[]>();
    
    communityNodes.forEach(c => memberMap.set(c.id, []));
    
    // Find all MEMBER_OF edges
    graph.relationships.forEach(rel => {
      if (rel.type === 'MEMBER_OF') {
        const communityId = rel.targetId;
        const memberId = rel.sourceId; // MEMBER_OF goes Member -> Community
        
        if (memberMap.has(communityId)) {
          const memberNode = graph.nodes.find(n => n.id === memberId);
          if (memberNode) {
            memberMap.get(communityId)?.push({
              name: memberNode.properties.name,
              filePath: memberNode.properties.filePath,
              type: memberNode.label
            });
          }
        }
      }
    });

    const { createChatModel } = await getAgent();
    const { SystemMessage } = await getLangCore();
    const { labelModulesBatch } = await getEnricher();
    const chatModel = await createChatModel(providerConfig);
    const llmClient = {
      generate: async (prompt: string): Promise<string> => {
        const response = await chatModel.invoke([
          new SystemMessage('You are a helpful code analysis assistant.'),
          { role: 'user', content: prompt }
        ]);
        return response.content as string;
      }
    };

    const { enrichments, tokensUsed } = await labelModulesBatch(
      communityNodes,
      memberMap,
      llmClient,
      5, // Batch size
      onProgress
    );

    if (import.meta.env.DEV) {
    }

    // Update graph nodes with enrichment data
    graph.nodes.forEach(node => {
      if (node.label === 'Community' && enrichments.has(node.id)) {
        const enrichment = enrichments.get(node.id)!;
        node.properties.name = enrichment.name;
        node.properties.keywords = enrichment.keywords;
        node.properties.description = enrichment.description;
        node.properties.enrichedBy = 'llm';
      }
    });

    // Update KuzuDB with new data
    try {
      const kuzu = await getKuzuAdapter();
        
      onProgress(enrichments.size, enrichments.size); // Done
      
      for (const [id, enrichment] of enrichments.entries()) {
         const escapeCypher = (str: string) => str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
         
         const keywordsStr = JSON.stringify(enrichment.keywords);
         const descStr = escapeCypher(enrichment.description);
         const nameStr = escapeCypher(enrichment.name);
         const escapedId = escapeCypher(id);
         
         const query = `
           MATCH (c:Community {id: "${escapedId}"})
           SET c.label = "${nameStr}", 
               c.keywords = ${keywordsStr}, 
               c.description = "${descStr}",
               c.enrichedBy = "llm"
         `;
         
         await kuzu.executeQuery(query);
      }
      
    } catch (err) {
      console.error('Enrichment sync failed:', err);
    }
    
    const enrichmentsRecord: Record<string, ClusterEnrichment> = {};
    for (const [id, val] of enrichments.entries()) {
      enrichmentsRecord[id] = val;
    }
     
    return { enrichments: enrichmentsRecord, tokensUsed };
  
  },
};

Comlink.expose(workerApi);

export type IndexerWorkerApi = typeof workerApi;

