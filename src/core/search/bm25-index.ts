/**
 * MiniSearch-backed BM25 keyword index.
 * Provides exact-term matching alongside the semantic (embedding) search path.
 */

import MiniSearch from 'minisearch';

export interface BM25Document {
  id: string;       // File path
  content: string;  // File content
  name: string;     // File name (boosted in search)
}

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
}

/** Stop words and language keywords that carry no retrieval signal */
const NOISE_TERMS: ReadonlySet<string> = new Set([
  // JS / TS language tokens
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'new', 'this', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined',
  // English stop words
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with',
  'to', 'of', 'it', 'be', 'as', 'by', 'that', 'for', 'are', 'was', 'were',
]);

/** Tokenise text: split on punctuation, expand camelCase, filter noise. */
const tokenise = (text: string): string[] => {
  const raw = text.toLowerCase().split(/[\s\-_./\\(){}[\]<>:;,!?'"]+/);
  const result: string[] = [];

  let idx = 0;
  while (idx < raw.length) {
    const tok = raw[idx];
    idx++;
    if (tok.length === 0) continue;

    // Split camelCase
    const subParts = tok
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(' ');

    subParts.forEach((sp) => result.push(sp));

    // Keep compound token for exact match
    if (subParts.length > 1) {
      result.push(tok);
    }
  }

  return result.filter((t) => t.length > 1 && !NOISE_TERMS.has(t));
};

/* Singleton index state */
let activeIndex: MiniSearch<BM25Document> | null = null;
let docTotal = 0;

/** Build the BM25 index from file contents (call after ingestion). */
export const buildBM25Index = (fileContents: Map<string, string>): number => {
  activeIndex = new MiniSearch<BM25Document>({
    fields: ['content', 'name'],
    storeFields: ['id'],
    tokenize: tokenise,
  });

  const docs: BM25Document[] = [];

  fileContents.forEach((content, filePath) => {
    const slash = filePath.lastIndexOf('/');
    const fileName = slash >= 0 ? filePath.substring(slash + 1) : filePath;
    docs.push({ id: filePath, content, name: fileName });
  });

  activeIndex.addAll(docs);
  docTotal = docs.length;

  return docTotal;
};

/** Query the BM25 index for keyword matches. */
export const searchBM25 = (query: string, limit: number = 20): BM25SearchResult[] => {
  if (activeIndex === null) return [];

  const hits = activeIndex.search(query, {
    fuzzy: 0.2,
    prefix: true,
    boost: { name: 2 },
  });

  const capped = hits.slice(0, limit);
  const output: BM25SearchResult[] = [];
  let rank = 1;

  capped.forEach((h) => {
    output.push({ filePath: h.id, score: h.score, rank });
    rank++;
  });

  return output;
};

/** True when the index is populated and queryable. */
export const isBM25Ready = (): boolean => {
  return activeIndex !== null && docTotal > 0;
};

/** Index statistics. */
export const getBM25Stats = (): { documentCount: number; termCount: number } => {
  if (activeIndex === null) {
    return { documentCount: 0, termCount: 0 };
  }
  return { documentCount: docTotal, termCount: activeIndex.termCount };
};

/** Drop the index (cleanup or re-index). */
export const clearBM25Index = (): void => {
  activeIndex = null;
  docTotal = 0;
};
