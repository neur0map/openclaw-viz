/**
 * RFC 4180 CSV generation for KuzuDB bulk loading.
 * Produces one CSV per node table and a single edge CSV.
 * All text fields are always double-quoted to safely embed source code.
 */

import { CodeGraph, GraphNode, NodeLabel } from '../graph/types';
import { NODE_TABLES, NodeTableName } from './schema';

// -- Field-level helpers -----------------------------------------------------

/** Remove control characters and invalid UTF-8 from CSV fields. */
const normalizeText = (raw: string): string => {
  let cleaned = raw.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');
  // Drop control characters except horizontal tab and newline
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Remove lone surrogate code units and Unicode specials
  cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '');
  cleaned = cleaned.replace(/[\uFFFE\uFFFF]/g, '');
  return cleaned;
};

/** Double-quote a value, escaping interior quotes per RFC 4180. */
const quoteField = (val: string | number | undefined | null): string => {
  if (val === undefined || val === null) return '""';
  const text = normalizeText(String(val));
  return '"' + text.replace(/"/g, '""') + '"';
};

/** Unquoted numeric field with fallback. */
const numericField = (val: number | undefined | null, fallback: number = -1): string =>
  (val === undefined || val === null) ? String(fallback) : String(val);

// -- Content extraction ------------------------------------------------------

/** Heuristic binary-content check. */
const detectBinary = (text: string): boolean => {
  if (!text || text.length === 0) return false;
  const probe = text.slice(0, 1000);
  let controlCount = 0;
  let idx = 0;
  while (idx < probe.length) {
    const ch = probe.charCodeAt(idx);
    if ((ch < 9) || (ch > 13 && ch < 32) || ch === 127) controlCount++;
    idx++;
  }
  return controlCount / probe.length > 0.1;
};

/** Extract source text for a node, with truncation. */
const resolveContent = (
  entry: GraphNode,
  sourceMap: Map<string, string>,
): string => {
  const fPath = entry.properties.filePath;
  const src = sourceMap.get(fPath);

  if (!src) return '';
  if (entry.label === 'Folder') return '';
  if (detectBinary(src)) return '[Binary file - content not stored]';

  // File nodes: full content, capped
  if (entry.label === 'File') {
    const CAP = 10000;
    return src.length > CAP
      ? src.slice(0, CAP) + '\n... [truncated]'
      : src;
  }

  // Symbol nodes: line range with padding
  const first = entry.properties.startLine;
  const last = entry.properties.endLine;
  if (first === undefined || last === undefined) return '';

  const allLines = src.split('\n');
  const PAD = 2;
  const lo = Math.max(0, first - PAD);
  const hi = Math.min(allLines.length - 1, last + PAD);
  const fragment = allLines.slice(lo, hi + 1).join('\n');

  const LIMIT = 5000;
  return fragment.length > LIMIT
    ? fragment.slice(0, LIMIT) + '\n... [truncated]'
    : fragment;
};

// -- Public types ------------------------------------------------------------

export interface CSVData {
  nodes: Map<NodeTableName, string>;
  relCSV: string;  // Single relation CSV with from,to,type,confidence,reason columns
}

// -- Per-table CSV builders --------------------------------------------------

/** File nodes: id, name, filePath, content */
const buildFileRows = (items: GraphNode[], sourceMap: Map<string, string>): string => {
  const out: string[] = ['id,name,filePath,content'];
  items.forEach((nd) => {
    if (nd.label !== 'File') return;
    const body = resolveContent(nd, sourceMap);
    out.push(
      [quoteField(nd.id), quoteField(nd.properties.name || ''), quoteField(nd.properties.filePath || ''), quoteField(body)].join(','),
    );
  });
  return out.join('\n');
};

/** Folder nodes: id, name, filePath */
const buildFolderRows = (items: GraphNode[]): string => {
  const out: string[] = ['id,name,filePath'];
  items.forEach((nd) => {
    if (nd.label !== 'Folder') return;
    out.push(
      [quoteField(nd.id), quoteField(nd.properties.name || ''), quoteField(nd.properties.filePath || '')].join(','),
    );
  });
  return out.join('\n');
};

/** Code-symbol nodes: id, name, filePath, startLine, endLine, isExported, content */
const buildSymbolRows = (
  items: GraphNode[],
  kind: NodeLabel,
  sourceMap: Map<string, string>,
): string => {
  const out: string[] = ['id,name,filePath,startLine,endLine,isExported,content'];
  items.forEach((nd) => {
    if (nd.label !== kind) return;
    const body = resolveContent(nd, sourceMap);
    out.push([
      quoteField(nd.id),
      quoteField(nd.properties.name || ''),
      quoteField(nd.properties.filePath || ''),
      numericField(nd.properties.startLine, -1),
      numericField(nd.properties.endLine, -1),
      nd.properties.isExported ? 'true' : 'false',
      quoteField(body),
    ].join(','));
  });
  return out.join('\n');
};

/** Community nodes: id, label, heuristicLabel, keywords, description, enrichedBy, cohesion, symbolCount */
const buildCommunityRows = (items: GraphNode[]): string => {
  const out: string[] = ['id,label,heuristicLabel,keywords,description,enrichedBy,cohesion,symbolCount'];
  items.forEach((nd) => {
    if (nd.label !== 'Community') return;
    const props = nd.properties as any;
    const kws: string[] = props.keywords || [];
    // KuzuDB STRING[] literal: ['a','b']
    const kwLiteral = '[' + kws.map((k: string) => "'" + k.replace(/'/g, "''") + "'").join(',') + ']';
    out.push([
      quoteField(nd.id),
      quoteField(nd.properties.name || ''),
      quoteField(nd.properties.heuristicLabel || ''),
      kwLiteral,
      quoteField(props.description || ''),
      quoteField(props.enrichedBy || 'heuristic'),
      numericField(nd.properties.cohesion, 0),
      numericField(nd.properties.symbolCount, 0),
    ].join(','));
  });
  return out.join('\n');
};

/** Process nodes: id, label, heuristicLabel, processType, stepCount, communities, entryPointId, terminalId */
const buildProcessRows = (items: GraphNode[]): string => {
  const out: string[] = ['id,label,heuristicLabel,processType,stepCount,communities,entryPointId,terminalId'];
  items.forEach((nd) => {
    if (nd.label !== 'Process') return;
    const props = nd.properties as any;
    const comms: string[] = props.communities || [];
    const commLiteral = '[' + comms.map((c: string) => "'" + c.replace(/'/g, "''") + "'").join(',') + ']';
    out.push([
      quoteField(nd.id),
      quoteField(nd.properties.name || ''),
      quoteField(props.heuristicLabel || ''),
      quoteField(props.processType || ''),
      numericField(props.stepCount, 0),
      quoteField(commLiteral),
      quoteField(props.entryPointId || ''),
      quoteField(props.terminalId || ''),
    ].join(','));
  });
  return out.join('\n');
};

/** Relations: from, to, type, confidence, reason, step */
const buildRelationRows = (graph: CodeGraph): string => {
  const out: string[] = ['from,to,type,confidence,reason,step'];
  graph.relationships.forEach((rel) => {
    out.push([
      quoteField(rel.sourceId),
      quoteField(rel.targetId),
      quoteField(rel.type),
      numericField(rel.confidence, 1.0),
      quoteField(rel.reason),
      numericField((rel as any).step, 0),
    ].join(','));
  });
  return out.join('\n');
};

// -- Orchestrator ------------------------------------------------------------

/** Generate CSV payloads for all node tables and the edge table. */
export const generateAllCSVs = (
  graph: CodeGraph,
  fileContents: Map<string, string>,
): CSVData => {
  const allNodes = Array.from(graph.nodes);

  const nodeCSVs = new Map<NodeTableName, string>();

  // FS tables
  nodeCSVs.set('File', buildFileRows(allNodes, fileContents));
  nodeCSVs.set('Folder', buildFolderRows(allNodes));

  // Code-symbol tables
  const symbolKinds: NodeLabel[] = ['Function', 'Class', 'Interface', 'Method', 'CodeElement'];
  symbolKinds.forEach((kind) => {
    nodeCSVs.set(kind as NodeTableName, buildSymbolRows(allNodes, kind, fileContents));
  });

  // Module and flow tables
  nodeCSVs.set('Community', buildCommunityRows(allNodes));
  nodeCSVs.set('Process', buildProcessRows(allNodes));

  // Edges
  const relCSV = buildRelationRows(graph);

  return { nodes: nodeCSVs, relCSV };
};
