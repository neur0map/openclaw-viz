import { createCodeGraph } from '../graph/graph';
import { extractZip, FileEntry } from '../../services/zip';
import { processStructure } from './structure-processor';
import { processParsing } from './parsing-processor';
import { processImports, createImportMap } from './import-processor';
import { processCalls } from './call-processor';
import { processHeritage } from './heritage-processor';
import { processCommunities, CommunityDetectionResult } from './community-processor';
import { processProcesses, ProcessDetectionResult } from './process-processor';
import { createSymbolTable } from './symbol-table';
import { createASTCache } from './ast-cache';
import { IndexingProgress, IndexingResult } from '../../types/pipeline';

// ---- Progress ----

function emitProgress(
  notify: (p: IndexingProgress) => void,
  phase: IndexingProgress['phase'],
  pct: number,
  msg: string,
  extra?: Partial<Pick<IndexingProgress, 'detail' | 'stats'>>
): void {
  notify({
    phase,
    percent: pct,
    message: msg,
    ...extra,
  });
}

function makeStats(processed: number, total: number, nodes: number): IndexingProgress['stats'] {
  return { filesProcessed: processed, totalFiles: total, nodesCreated: nodes };
}

// ---- Phases ----

async function extractPhase(
  file: File,
  notify: (p: IndexingProgress) => void
): Promise<FileEntry[]> {
  emitProgress(notify, 'extracting', 0, 'Unpacking archive...');

  const ticker = setInterval(() => {
    emitProgress(notify, 'extracting', Math.min(14, Math.random() * 10 + 5), 'Unpacking archive...');
  }, 200);

  const entries = await extractZip(file);
  clearInterval(ticker);

  return entries;
}

function structurePhase(
  graph: ReturnType<typeof createCodeGraph>,
  entries: FileEntry[],
  notify: (p: IndexingProgress) => void
): void {
  const fileCount = entries.length;

  emitProgress(notify, 'structure', 15, 'Mapping file tree...', {
    stats: makeStats(0, fileCount, 0),
  });

  processStructure(graph, entries.map(e => e.path));

  emitProgress(notify, 'structure', 30, 'File tree mapped', {
    stats: makeStats(fileCount, fileCount, graph.nodeCount),
  });
}

async function parsingPhase(
  graph: ReturnType<typeof createCodeGraph>,
  entries: FileEntry[],
  symbolTbl: ReturnType<typeof createSymbolTable>,
  astStore: ReturnType<typeof createASTCache>,
  notify: (p: IndexingProgress) => void
): Promise<void> {
  emitProgress(notify, 'parsing', 30, 'Extracting symbols...', {
    stats: makeStats(0, entries.length, graph.nodeCount),
  });

  await processParsing(graph, entries, symbolTbl, astStore, (done, total, currentFile) => {
    const pct = 30 + ((done / total) * 40);
    emitProgress(notify, 'parsing', Math.round(pct), 'Extracting symbols...', {
      detail: currentFile,
      stats: makeStats(done, total, graph.nodeCount),
    });
  });
}

async function importPhase(
  graph: ReturnType<typeof createCodeGraph>,
  entries: FileEntry[],
  astStore: ReturnType<typeof createASTCache>,
  impMap: ReturnType<typeof createImportMap>,
  notify: (p: IndexingProgress) => void
): Promise<void> {
  emitProgress(notify, 'imports', 70, 'Resolving dependencies...', {
    stats: makeStats(0, entries.length, graph.nodeCount),
  });

  await processImports(graph, entries, astStore, impMap, (done, total) => {
    const pct = 70 + ((done / total) * 12);
    emitProgress(notify, 'imports', Math.round(pct), 'Resolving dependencies...', {
      stats: makeStats(done, total, graph.nodeCount),
    });
  });
}

async function callPhase(
  graph: ReturnType<typeof createCodeGraph>,
  entries: FileEntry[],
  astStore: ReturnType<typeof createASTCache>,
  symbolTbl: ReturnType<typeof createSymbolTable>,
  impMap: ReturnType<typeof createImportMap>,
  notify: (p: IndexingProgress) => void
): Promise<void> {
  emitProgress(notify, 'calls', 82, 'Tracing call graph...', {
    stats: makeStats(0, entries.length, graph.nodeCount),
  });

  await processCalls(graph, entries, astStore, symbolTbl, impMap, (done, total) => {
    const pct = 82 + ((done / total) * 10);
    emitProgress(notify, 'calls', Math.round(pct), 'Tracing call graph...', {
      stats: makeStats(done, total, graph.nodeCount),
    });
  });
}

async function heritagePhase(
  graph: ReturnType<typeof createCodeGraph>,
  entries: FileEntry[],
  astStore: ReturnType<typeof createASTCache>,
  symbolTbl: ReturnType<typeof createSymbolTable>,
  notify: (p: IndexingProgress) => void
): Promise<void> {
  emitProgress(notify, 'heritage', 92, 'Linking inheritance chains...', {
    stats: makeStats(0, entries.length, graph.nodeCount),
  });

  await processHeritage(graph, entries, astStore, symbolTbl, (done, total) => {
    const pct = 88 + ((done / total) * 4);
    emitProgress(notify, 'heritage', Math.round(pct), 'Linking inheritance chains...', {
      stats: makeStats(done, total, graph.nodeCount),
    });
  });
}

async function communityPhase(
  graph: ReturnType<typeof createCodeGraph>,
  fileCount: number,
  notify: (p: IndexingProgress) => void
): Promise<CommunityDetectionResult> {
  emitProgress(notify, 'communities', 92, 'Clustering modules...', {
    stats: makeStats(fileCount, fileCount, graph.nodeCount),
  });

  const result = await processCommunities(graph, (msg, pct) => {
    const adjustedPct = 92 + (pct * 0.06);
    emitProgress(notify, 'communities', Math.round(adjustedPct), msg, {
      stats: makeStats(fileCount, fileCount, graph.nodeCount),
    });
  });

  return result;
}

function applyCommunityResults(
  graph: ReturnType<typeof createCodeGraph>,
  communityData: CommunityDetectionResult
): void {
  for (const comm of communityData.communities) {
    graph.addNode({
      id: comm.id,
      label: 'Community' as const,
      properties: {
        name: comm.label,
        filePath: '',
        heuristicLabel: comm.heuristicLabel,
        cohesion: comm.cohesion,
        symbolCount: comm.symbolCount,
      },
    });
  }

  for (const membership of communityData.memberships) {
    graph.addRelationship({
      id: `${membership.nodeId}_member_of_${membership.communityId}`,
      type: 'MEMBER_OF',
      sourceId: membership.nodeId,
      targetId: membership.communityId,
      confidence: 1.0,
      reason: 'louvain-algorithm',
    });
  }
}

async function processPhase(
  graph: ReturnType<typeof createCodeGraph>,
  memberships: CommunityDetectionResult['memberships'],
  fileCount: number,
  notify: (p: IndexingProgress) => void
): Promise<ProcessDetectionResult> {
  emitProgress(notify, 'processes', 98, 'Mapping execution flows...', {
    stats: makeStats(fileCount, fileCount, graph.nodeCount),
  });

  const result = await processProcesses(graph, memberships, (msg, pct) => {
    const adjustedPct = 98 + (pct * 0.01);
    emitProgress(notify, 'processes', Math.round(adjustedPct), msg, {
      stats: makeStats(fileCount, fileCount, graph.nodeCount),
    });
  });

  return result;
}

function applyProcessResults(
  graph: ReturnType<typeof createCodeGraph>,
  procData: ProcessDetectionResult
): void {
  for (const proc of procData.processes) {
    graph.addNode({
      id: proc.id,
      label: 'Process' as const,
      properties: {
        name: proc.label,
        filePath: '',
        heuristicLabel: proc.heuristicLabel,
        processType: proc.processType,
        stepCount: proc.stepCount,
        communities: proc.communities,
        entryPointId: proc.entryPointId,
        terminalId: proc.terminalId,
      },
    });
  }

  for (const step of procData.steps) {
    graph.addRelationship({
      id: `${step.nodeId}_step_${step.step}_${step.processId}`,
      type: 'STEP_IN_PROCESS',
      sourceId: step.nodeId,
      targetId: step.processId,
      confidence: 1.0,
      reason: 'trace-detection',
      step: step.step,
    });
  }
}

// ---- Public API ----

export const runIngestionPipeline = async (
  file: File,
  onProgress: (progress: IndexingProgress) => void
): Promise<IndexingResult> => {
  const entries = await extractPhase(file, onProgress);
  return runPipelineFromFiles(entries, onProgress);
};

export const runPipelineFromFiles = async (
  files: FileEntry[],
  onProgress: (progress: IndexingProgress) => void
): Promise<IndexingResult> => {
  const graph = createCodeGraph();
  const fileContents = new Map<string, string>();
  const symbolTable = createSymbolTable();
  const astCache = createASTCache(50);
  const importMap = createImportMap();

  const teardown = () => {
    astCache.clear();
    symbolTable.clear();
  };

  try {
    for (const entry of files) {
      fileContents.set(entry.path, entry.content);
    }

    emitProgress(onProgress, 'extracting', 15, 'Source files loaded', {
      stats: makeStats(0, files.length, 0),
    });

    structurePhase(graph, files, onProgress);

    await parsingPhase(graph, files, symbolTable, astCache, onProgress);

    await importPhase(graph, files, astCache, importMap, onProgress);

    await callPhase(graph, files, astCache, symbolTable, importMap, onProgress);

    await heritagePhase(graph, files, astCache, symbolTable, onProgress);

    const communityResult = await communityPhase(graph, files.length, onProgress);

    if (import.meta.env.DEV) {
    }

    applyCommunityResults(graph, communityResult);

    const processResult = await processPhase(graph, communityResult.memberships, files.length, onProgress);

    if (import.meta.env.DEV) {
    }

    applyProcessResults(graph, processResult);

    emitProgress(
      onProgress,
      'complete',
      100,
      `Graph complete! ${communityResult.stats.totalCommunities} communities, ${processResult.stats.totalProcesses} processes detected.`,
      { stats: makeStats(files.length, files.length, graph.nodeCount) }
    );

    astCache.clear();

    return { graph, fileContents, communityResult, processResult };
  } catch (err) {
    teardown();
    throw err;
  }
};
