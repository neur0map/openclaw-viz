/**
 * Converts code graph nodes into plain-text for embedding models.
 * Each node type yields a structured header plus a trimmed code snippet.
 */

import type { EmbeddableNode, EmbeddingConfig } from './types';
import { DEFAULT_EMBEDDING_CONFIG } from './types';

/* Per-label text production strategy */
type TextProducer = (node: EmbeddableNode, snippetCap: number) => string;

/** Extract filename from a full path. */
const extractFilename = (fullPath: string): string => {
  const idx = fullPath.lastIndexOf('/');
  return idx >= 0 ? fullPath.substring(idx + 1) : fullPath;
};

/** Extract parent directory from a full path. */
const extractParentDir = (fullPath: string): string => {
  const idx = fullPath.lastIndexOf('/');
  return idx >= 0 ? fullPath.substring(0, idx) : '';
};

/** Truncate text to a budget, preferring word boundaries. */
const capText = (text: string, budget: number): string => {
  if (text.length <= budget) return text;

  const slice = text.substring(0, budget);
  const boundary = slice.lastIndexOf(' ');

  if (boundary > budget * 0.8) {
    return slice.substring(0, boundary) + '...';
  }
  return slice + '...';
};

/** Normalise whitespace: unify line endings, collapse blanks, trim trailing spaces. */
const sanitizeSource = (raw: string): string => {
  const unified = raw.replace(/\r\n/g, '\n');
  const collapsed = unified.replace(/\n{3,}/g, '\n\n');
  return collapsed
    .split('\n')
    .reduce<string[]>((acc, ln) => { acc.push(ln.trimEnd()); return acc; }, [])
    .join('\n')
    .trim();
};

/** Structured text for code-element nodes (Function, Class, Method, Interface). */
const buildCodeElementText = (
  kind: string,
  node: EmbeddableNode,
  snippetCap: number
): string => {
  const header = [`${kind}: ${node.name}`, `File: ${extractFilename(node.filePath)}`];

  const dir = extractParentDir(node.filePath);
  if (dir) header.push(`Directory: ${dir}`);

  if (node.content) {
    const cleaned = sanitizeSource(node.content);
    header.push('', capText(cleaned, snippetCap));
  }

  return header.join('\n');
};

/** Text for File nodes (shorter snippet ceiling). */
const buildFileText: TextProducer = (node, snippetCap) => {
  const segments = [`File: ${node.name}`, `Path: ${node.filePath}`];

  if (node.content) {
    const cleaned = sanitizeSource(node.content);
    const ceiling = snippetCap < 300 ? snippetCap : 300;
    segments.push('', capText(cleaned, ceiling));
  }

  return segments.join('\n');
};

/** Label-to-producer dispatch. */
const PRODUCERS: Record<string, TextProducer> = {
  Function: (n, cap) => buildCodeElementText('Function', n, cap),
  Class:    (n, cap) => buildCodeElementText('Class', n, cap),
  Method:   (n, cap) => buildCodeElementText('Method', n, cap),
  Interface:(n, cap) => buildCodeElementText('Interface', n, cap),
  File:     buildFileText,
};

/** Produce embedding text for a single node, dispatched by label. */
export const generateEmbeddingText = (
  node: EmbeddableNode,
  config: Partial<EmbeddingConfig> = {}
): string => {
  const snippetLimit = config.maxSnippetLength ?? DEFAULT_EMBEDDING_CONFIG.maxSnippetLength;
  const producer = PRODUCERS[node.label];

  if (producer) return producer(node, snippetLimit);

  // Fallback for unknown labels
  return `${node.label}: ${node.name}\nPath: ${node.filePath}`;
};

/** Produce embedding texts for a batch of nodes (order preserved). */
export const prepareBatchTexts = (
  nodes: EmbeddableNode[],
  config: Partial<EmbeddingConfig> = {}
): string[] => {
  const out: string[] = [];
  nodes.forEach((nd) => out.push(generateEmbeddingText(nd, config)));
  return out;
};
