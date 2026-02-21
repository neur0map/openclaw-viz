/**
 * Louvain-based community detection for code graphs.
 *
 * Groups related symbols (functions, classes, methods, interfaces)
 * using CALLS / EXTENDS / IMPLEMENTS edges. The detected modules
 * enable navigation by functional area.
 */

import Graph from 'graphology';
import louvain from '../../lib/louvain';
import { CodeGraph, NodeLabel } from '../graph/types';

// -- Color palette for module visualisation -----------------------------------

export const MODULE_PALETTE = [
  '#3a7ef2',
  '#0eb0cf',
  '#875af2',
  '#e84040',
  '#f56f12',
  '#e5ae04',
  '#1fbf58',
  '#d540eb',
  '#e84494',
  '#f03a59',
  '#10b3a1',
  '#80c812',
];

export const getModuleColor = (communityIndex: number): string => {
  return MODULE_PALETTE[communityIndex % MODULE_PALETTE.length];
};

// -- Exported types ----------------------------------------------------------

export interface CommunityNode {
  id: string;
  label: string;
  heuristicLabel: string;
  cohesion: number;
  symbolCount: number;
}

export interface CommunityMembership {
  nodeId: string;
  communityId: string;
}

export interface CommunityDetectionResult {
  communities: CommunityNode[];
  memberships: CommunityMembership[];
  stats: {
    totalCommunities: number;
    modularity: number;
    nodesProcessed: number;
  };
}

// -- Internal helpers --------------------------------------------------------

/** Find the longest common prefix across a set of strings. */
const extractSharedPrefix = (items: string[]): string => {
  if (items.length === 0) return '';

  const ordered = [...items].sort();
  const head = ordered[0];
  const tail = ordered[ordered.length - 1];

  let cursor = 0;
  while (cursor < head.length && head[cursor] === tail[cursor]) {
    cursor++;
  }
  return head.slice(0, cursor);
};

/** Internal edge density of a node set (0..1). */
const computeDensity = (nodeIds: string[], graph: Graph): number => {
  const size = nodeIds.length;
  if (size <= 1) return 1.0;

  const idLookup = new Set(nodeIds);
  let pairCount = 0;

  for (const nid of nodeIds) {
    if (!graph.hasNode(nid)) continue;
    graph.forEachNeighbor(nid, (adj) => {
      if (idLookup.has(adj)) pairCount++;
    });
  }

  // Each edge is counted from both endpoints, so halve
  const edgeCount = pairCount / 2;
  const maxEdges = (size * (size - 1)) / 2;

  return maxEdges === 0 ? 1.0 : Math.min(1.0, edgeCount / maxEdges);
};

// Generic directory names excluded from module labelling
const GENERIC_DIRS = new Set([
  'src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers',
]);

/** Derive a human-readable label from member file paths and symbol names. */
const deriveLabel = (
  nodeIds: string[],
  pathIndex: Map<string, string>,
  graph: Graph,
  communityNum: number,
): string => {
  // Count parent-directory frequency
  const dirTally: Record<string, number> = {};

  for (const nid of nodeIds) {
    const fp = pathIndex.get(nid) ?? '';
    const segments = fp.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const parentDir = segments[segments.length - 2];
      if (!GENERIC_DIRS.has(parentDir.toLowerCase())) {
        dirTally[parentDir] = (dirTally[parentDir] || 0) + 1;
      }
    }
  }

  // Select the dominant directory
  let topDir = '';
  let topCount = 0;
  for (const [dir, cnt] of Object.entries(dirTally)) {
    if (cnt > topCount) {
      topCount = cnt;
      topDir = dir;
    }
  }

  if (topDir) {
    return topDir.charAt(0).toUpperCase() + topDir.slice(1);
  }

  // Try shared prefix of symbol names as fallback
  const symbolNames: string[] = [];
  for (const nid of nodeIds) {
    const n = graph.getNodeAttribute(nid, 'name');
    if (n) symbolNames.push(n);
  }

  if (symbolNames.length > 2) {
    const prefix = extractSharedPrefix(symbolNames);
    if (prefix.length > 2) {
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
  }

  return `Cluster_${communityNum}`;
};

/** Build an undirected graphology graph from symbol nodes and clustering edges. */
const buildUndirectedGraph = (kg: CodeGraph): Graph => {
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });

  const includedLabels = new Set<NodeLabel>(['Function', 'Class', 'Method', 'Interface']);

  // Add symbol nodes
  for (const node of kg.nodes) {
    if (includedLabels.has(node.label)) {
      g.addNode(node.id, {
        name: node.properties.name,
        filePath: node.properties.filePath,
        type: node.label,
      });
    }
  }

  // Add clustering-relevant edges
  const edgeTypes = new Set(['CALLS', 'EXTENDS', 'IMPLEMENTS']);

  for (const rel of kg.relationships) {
    if (!edgeTypes.has(rel.type)) continue;
    if (rel.sourceId === rel.targetId) continue;
    if (!g.hasNode(rel.sourceId) || !g.hasNode(rel.targetId)) continue;
    if (g.hasEdge(rel.sourceId, rel.targetId)) continue;
    g.addEdge(rel.sourceId, rel.targetId);
  }

  return g;
};

// -- Main entry point --------------------------------------------------------

export const processCommunities = async (
  codeGraph: CodeGraph,
  onProgress?: (message: string, progress: number) => void,
): Promise<CommunityDetectionResult> => {
  onProgress?.('Building graph for community detection...', 0);

  const undirected = buildUndirectedGraph(codeGraph);

  if (undirected.order === 0) {
    return {
      communities: [],
      memberships: [],
      stats: { totalCommunities: 0, modularity: 0, nodesProcessed: 0 },
    };
  }

  onProgress?.(`Running community detection on ${undirected.order} nodes...`, 30);

  const outcome = louvain.detailed(undirected, {
    resolution: 1.0,
  });

  onProgress?.(`Found ${outcome.count} communities...`, 60);

  // Path lookup for labelling
  const pathLookup = new Map<string, string>();
  for (const node of codeGraph.nodes) {
    if (node.properties.filePath) {
      pathLookup.set(node.id, node.properties.filePath);
    }
  }

  // Group node IDs by community assignment
  const buckets = new Map<number, string[]>();
  const assignments = outcome.communities as Record<string, number>;

  for (const [nid, cnum] of Object.entries(assignments)) {
    const bucket = buckets.get(cnum);
    if (bucket) {
      bucket.push(nid);
    } else {
      buckets.set(cnum, [nid]);
    }
  }

  // Create community nodes, excluding singletons
  const communityNodes: CommunityNode[] = [];

  buckets.forEach((ids, cnum) => {
    if (ids.length < 2) return;

    const tag = deriveLabel(ids, pathLookup, undirected, cnum);
    communityNodes.push({
      id: `comm_${cnum}`,
      label: tag,
      heuristicLabel: tag,
      cohesion: computeDensity(ids, undirected),
      symbolCount: ids.length,
    });
  });

  // Sort by size descending
  communityNodes.sort((a, b) => b.symbolCount - a.symbolCount);

  onProgress?.('Creating membership edges...', 80);

  // Assemble membership list
  const memberships: CommunityMembership[] = Object.entries(assignments).map(
    ([nodeId, cnum]) => ({ nodeId, communityId: `comm_${cnum}` }),
  );

  onProgress?.('Community detection complete!', 100);

  return {
    communities: communityNodes,
    memberships,
    stats: {
      totalCommunities: outcome.count,
      modularity: outcome.modularity,
      nodesProcessed: undirected.order,
    },
  };
};
