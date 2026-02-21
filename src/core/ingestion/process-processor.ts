/**
 * Execution-flow detection.
 *
 * Finds feature flows by ranking entry points, tracing CALLS edges
 * via bounded BFS, deduplicating overlapping traces, and emitting
 * labelled Process nodes with step metadata.
 */

import { CodeGraph, GraphNode, GraphRelationship, NodeLabel } from '../graph/types';
import { CommunityMembership } from './community-processor';
import { calculateEntryPointScore, isTestFile } from './entry-point-scoring';

// -- Configuration -----------------------------------------------------------

export interface ProcessDetectionConfig {
  maxTraceDepth: number;
  maxBranching: number;
  maxProcesses: number;
  minSteps: number;
}

const DEFAULT_CONFIG: ProcessDetectionConfig = {
  maxTraceDepth: 10,
  maxBranching: 4,
  maxProcesses: 75,
  minSteps: 2,
};

// -- Public result types -----------------------------------------------------

export interface ProcessNode {
  id: string;
  label: string;
  heuristicLabel: string;
  processType: 'intra_community' | 'cross_community';
  stepCount: number;
  communities: string[];
  entryPointId: string;
  terminalId: string;
  trace: string[];
}

export interface ProcessStep {
  nodeId: string;
  processId: string;
  step: number;
}

export interface ProcessDetectionResult {
  processes: ProcessNode[];
  steps: ProcessStep[];
  stats: {
    totalProcesses: number;
    crossCommunityCount: number;
    avgStepCount: number;
    entryPointsFound: number;
  };
}

// -- Adjacency helpers -------------------------------------------------------

type Neighbours = Map<string, string[]>;

/** Forward adjacency from CALLS edges. */
const forwardAdjacency = (kg: CodeGraph): Neighbours => {
  const fwd: Neighbours = new Map();
  for (const rel of kg.relationships) {
    if (rel.type !== 'CALLS') continue;
    const existing = fwd.get(rel.sourceId);
    if (existing) {
      existing.push(rel.targetId);
    } else {
      fwd.set(rel.sourceId, [rel.targetId]);
    }
  }
  return fwd;
};

/** Reverse adjacency from CALLS edges. */
const reverseAdjacency = (kg: CodeGraph): Neighbours => {
  const rev: Neighbours = new Map();
  for (const rel of kg.relationships) {
    if (rel.type !== 'CALLS') continue;
    const existing = rev.get(rel.targetId);
    if (existing) {
      existing.push(rel.sourceId);
    } else {
      rev.set(rel.targetId, [rel.sourceId]);
    }
  }
  return rev;
};

// -- Entry-point ranking -----------------------------------------------------

const rankEntryPoints = (
  kg: CodeGraph,
  fwd: Neighbours,
  rev: Neighbours,
): string[] => {
  const eligible = new Set<NodeLabel>(['Function', 'Method']);

  const scored: Array<{ nid: string; value: number; tags: string[] }> = [];

  for (const node of kg.nodes) {
    if (!eligible.has(node.label)) continue;

    const fp = node.properties.filePath ?? '';
    if (isTestFile(fp)) continue;

    const outgoing = fwd.get(node.id) ?? [];
    if (outgoing.length === 0) continue;

    const incoming = rev.get(node.id) ?? [];

    const { score, reasons } = calculateEntryPointScore(
      node.properties.name,
      node.properties.language ?? 'javascript',
      node.properties.isExported ?? false,
      incoming.length,
      outgoing.length,
      fp,
    );

    if (score > 0) {
      scored.push({ nid: node.id, value: score, tags: reasons });
    }
  }

  scored.sort((a, b) => b.value - a.value);

  return scored.slice(0, 200).map((s) => s.nid);
};

// -- BFS trace ---------------------------------------------------------------

/** BFS forward from a single entry point, returning bounded paths. */
const explorePaths = (
  origin: string,
  fwd: Neighbours,
  cfg: ProcessDetectionConfig,
): string[][] => {
  const collected: string[][] = [];

  // [current node, path so far]
  const frontier: Array<[string, string[]]> = [[origin, [origin]]];

  while (frontier.length > 0 && collected.length < cfg.maxBranching * 3) {
    const [cur, trail] = frontier.shift()!;
    const targets = fwd.get(cur) ?? [];

    if (targets.length === 0) {
      // Leaf -- emit if long enough
      if (trail.length >= cfg.minSteps) collected.push(trail.slice());
      continue;
    }

    if (trail.length >= cfg.maxTraceDepth) {
      if (trail.length >= cfg.minSteps) collected.push(trail.slice());
      continue;
    }

    const bounded = targets.slice(0, cfg.maxBranching);
    let extended = false;

    for (const tgt of bounded) {
      if (trail.indexOf(tgt) === -1) {
        frontier.push([tgt, [...trail, tgt]]);
        extended = true;
      }
    }

    // Cycle detected -- treat as terminal
    if (!extended && trail.length >= cfg.minSteps) {
      collected.push(trail.slice());
    }
  }

  return collected;
};

// -- Trace deduplication -----------------------------------------------------

/** Remove traces subsumed by longer ones. */
const removeRedundantTraces = (raw: string[][]): string[][] => {
  if (raw.length === 0) return [];

  const descending = [...raw].sort((a, b) => b.length - a.length);
  const kept: string[][] = [];

  for (const candidate of descending) {
    const key = candidate.join('->');
    const subsumed = kept.some((existing) => existing.join('->').includes(key));
    if (!subsumed) kept.push(candidate);
  }

  return kept;
};

// -- String utilities --------------------------------------------------------

const titleCase = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.substring(1);

const toSafeId = (s: string): string =>
  s.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20).toLowerCase();

// -- Main processor ----------------------------------------------------------

export const processProcesses = async (
  codeGraph: CodeGraph,
  memberships: CommunityMembership[],
  onProgress?: (message: string, progress: number) => void,
  config: Partial<ProcessDetectionConfig> = {},
): Promise<ProcessDetectionResult> => {
  const cfg: ProcessDetectionConfig = { ...DEFAULT_CONFIG, ...config };

  onProgress?.('Finding entry points...', 0);

  // Map nodes to their community
  const communityOf = new Map<string, string>();
  for (const m of memberships) communityOf.set(m.nodeId, m.communityId);

  // Adjacency maps
  const fwd = forwardAdjacency(codeGraph);
  const rev = reverseAdjacency(codeGraph);

  // Node lookup
  const nodeById = new Map<string, GraphNode>();
  for (const n of codeGraph.nodes) nodeById.set(n.id, n);

  // Score and rank entry points
  const seeds = rankEntryPoints(codeGraph, fwd, rev);

  onProgress?.(`Found ${seeds.length} entry points, tracing flows...`, 20);

  onProgress?.(`Found ${seeds.length} entry points, tracing flows...`, 20);

  // Trace forward from each seed
  const rawTraces: string[][] = [];
  const traceLimit = cfg.maxProcesses * 2;

  for (let idx = 0; idx < seeds.length && rawTraces.length < traceLimit; idx++) {
    const paths = explorePaths(seeds[idx], fwd, cfg);

    for (const p of paths) {
      if (p.length >= cfg.minSteps) rawTraces.push(p);
    }

    if (idx % 10 === 0) {
      const pct = 20 + (idx / seeds.length) * 40;
      onProgress?.(`Tracing entry point ${idx + 1}/${seeds.length}...`, pct);
    }
  }

  onProgress?.(`Found ${rawTraces.length} traces, deduplicating...`, 60);

  const deduped = removeRedundantTraces(rawTraces);

  // Retain the longest traces, capped at maxProcesses
  const finalTraces = deduped
    .sort((a, b) => b.length - a.length)
    .slice(0, cfg.maxProcesses);

  onProgress?.(`Creating ${finalTraces.length} process nodes...`, 80);

  // Build Process nodes and step records
  const processes: ProcessNode[] = [];
  const steps: ProcessStep[] = [];

  finalTraces.forEach((trace, seqNum) => {
    const headId = trace[0];
    const tailId = trace[trace.length - 1];

    // Collect distinct communities along the trace
    const touchedComms = new Set<string>();
    for (const nid of trace) {
      const c = communityOf.get(nid);
      if (c) touchedComms.add(c);
    }
    const commList = Array.from(touchedComms);

    const kind: 'intra_community' | 'cross_community' =
      commList.length > 1 ? 'cross_community' : 'intra_community';

    const headNode = nodeById.get(headId);
    const tailNode = nodeById.get(tailId);
    const headName = headNode?.properties.name ?? 'Unknown';
    const tailName = tailNode?.properties.name ?? 'Unknown';
    const tag = `${titleCase(headName)} → ${titleCase(tailName)}`;

    const pid = `proc_${seqNum}_${toSafeId(headName)}`;

    processes.push({
      id: pid,
      label: tag,
      heuristicLabel: tag,
      processType: kind,
      stepCount: trace.length,
      communities: commList,
      entryPointId: headId,
      terminalId: tailId,
      trace,
    });

    trace.forEach((nid, pos) => {
      steps.push({ nodeId: nid, processId: pid, step: pos + 1 });
    });
  });

  onProgress?.('Process detection complete!', 100);

  // Summary statistics
  let crossCount = 0;
  let totalSteps = 0;
  for (const p of processes) {
    if (p.processType === 'cross_community') crossCount++;
    totalSteps += p.stepCount;
  }
  const mean = processes.length > 0 ? totalSteps / processes.length : 0;

  return {
    processes,
    steps,
    stats: {
      totalProcesses: processes.length,
      crossCommunityCount: crossCount,
      avgStepCount: Math.round(mean * 10) / 10,
      entryPointsFound: seeds.length,
    },
  };
};
