/**
 * Reciprocal Rank Fusion (RRF) merging of BM25 and semantic results.
 * Relies on rank positions rather than raw scores, giving stable
 * fusion across different scoring scales.
 */

import { searchBM25, isBM25Ready, type BM25SearchResult } from './bm25-index';
import type { SemanticSearchResult } from '../embeddings/types';

/** RRF smoothing constant (k=60) */
const FUSION_K = 60;

export interface SearchHit {
  filePath: string;
  score: number;           // RRF score
  rank: number;            // Final rank
  sources: ('bm25' | 'semantic')[];  // Which methods found this

  // Metadata from semantic search (if available)
  nodeId?: string;
  name?: string;
  label?: string;
  startLine?: number;
  endLine?: number;

  // Per-source scores for diagnostics
  bm25Score?: number;
  semanticScore?: number;
}

/** RRF weight for a 0-based rank position. */
const rrfWeight = (position: number): number => 1 / (FUSION_K + position + 1);

/** Copy semantic metadata onto a result entry. */
const applySemantic = (
  entry: SearchHit,
  src: SemanticSearchResult
): void => {
  entry.nodeId = src.nodeId;
  entry.name = src.name;
  entry.label = src.label;
  entry.startLine = src.startLine;
  entry.endLine = src.endLine;
};

/** Fuse BM25 and semantic results via RRF and return ranked hits. */
export const mergeWithRRF = (
  bm25Results: BM25SearchResult[],
  semanticResults: SemanticSearchResult[],
  limit: number = 10
): SearchHit[] => {
  const registry = new Map<string, SearchHit>();

  // Accumulate BM25 hits
  bm25Results.forEach((hit, pos) => {
    registry.set(hit.filePath, {
      filePath: hit.filePath,
      score: rrfWeight(pos),
      rank: 0,
      sources: ['bm25'],
      bm25Score: hit.score,
    });
  });

  // Merge semantic hits, combining scores when paths overlap
  semanticResults.forEach((hit, pos) => {
    const weight = rrfWeight(pos);
    const prev = registry.get(hit.filePath);

    if (prev !== undefined) {
      prev.score += weight;
      prev.sources.push('semantic');
      prev.semanticScore = 1 - hit.distance;
      applySemantic(prev, hit);
    } else {
      const entry: SearchHit = {
        filePath: hit.filePath,
        score: weight,
        rank: 0,
        sources: ['semantic'],
        semanticScore: 1 - hit.distance,
      };
      applySemantic(entry, hit);
      registry.set(hit.filePath, entry);
    }
  });

  // Sort by RRF score descending, cap at limit
  const ranked = [...registry.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  let position = 1;
  ranked.forEach((entry) => {
    entry.rank = position;
    position++;
  });

  return ranked;
};

/** True when the BM25 index is built (semantic is optional). */
export const isHybridSearchReady = (): boolean => {
  return isBM25Ready();
};

/** Format search hits as a text block for LLM consumption. */
export const formatHybridResults = (results: SearchHit[]): string => {
  if (results.length === 0) return 'No results found.';

  const blocks: string[] = [];

  results.forEach((entry, idx) => {
    const methodStr = entry.sources.join(' + ');
    const locSuffix = entry.startLine ? ` (lines ${entry.startLine}-${entry.endLine})` : '';
    const prefix = entry.label ? `${entry.label}: ` : 'File: ';
    const displayName = entry.name || entry.filePath.split('/').pop() || entry.filePath;

    blocks.push(
      `[${idx + 1}] ${prefix}${displayName}\n` +
      `    File: ${entry.filePath}${locSuffix}\n` +
      `    Found by: ${methodStr}\n` +
      `    Relevance: ${entry.score.toFixed(4)}`
    );
  });

  return `Found ${results.length} results:\n\n${blocks.join('\n\n')}`;
};
