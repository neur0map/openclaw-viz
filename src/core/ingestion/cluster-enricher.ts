/**
 * Uses an LLM to refine heuristic module labels into semantic names,
 * keywords, and descriptions. Supports per-cluster and batched strategies.
 */

import { CommunityNode } from './community-processor';

// -- Types -------------------------------------------------------------------

export interface ClusterEnrichment {
  name: string;
  keywords: string[];
  description: string;
}

export interface EnrichmentResult {
  enrichments: Map<string, ClusterEnrichment>;
  tokensUsed: number;
}

export interface LLMClient {
  generate: (prompt: string) => Promise<string>;
}

export interface ClusterMemberInfo {
  name: string;
  filePath: string;
  type: string;
}

// -- Prompt assembly ---------------------------------------------------------

const composePrompt = (
  items: ClusterMemberInfo[],
  heuristic: string,
): string => {
  const capped = items.slice(0, 20);
  const listing = capped.map((m) => `${m.name} (${m.type})`).join(', ');
  const overflow = items.length > 20 ? ` (+${items.length - 20} more)` : '';

  return [
    'Analyze this code cluster and provide a semantic name and short description.',
    '',
    `Heuristic: "${heuristic}"`,
    `Members: ${listing}${overflow}`,
    '',
    'Reply with JSON only:',
    '{"name": "2-4 word semantic name", "description": "One sentence describing purpose"}',
  ].join('\n');
};

// -- Response decoding -------------------------------------------------------

const decodeResponse = (
  raw: string,
  fallback: string,
): ClusterEnrichment => {
  try {
    const fragment = raw.match(/\{[\s\S]*\}/);
    if (!fragment) throw new Error('No JSON found in response');

    const obj = JSON.parse(fragment[0]);
    return {
      name: obj.name || fallback,
      keywords: Array.isArray(obj.keywords) ? obj.keywords : [],
      description: obj.description || '',
    };
  } catch {
    return { name: fallback, keywords: [], description: '' };
  }
};

/** Rough token estimate: character count divided by four. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Default enrichment using only the heuristic label. */
const fallbackEnrichment = (label: string): ClusterEnrichment => ({
  name: label,
  keywords: [],
  description: '',
});

// -- Per-cluster enrichment --------------------------------------------------

/**
 * Enrich each module one at a time with individual LLM calls.
 */
export const enrichClusters = async (
  communities: CommunityNode[],
  memberMap: Map<string, ClusterMemberInfo[]>,
  llmClient: LLMClient,
  onProgress?: (current: number, total: number) => void,
): Promise<EnrichmentResult> => {
  const results = new Map<string, ClusterEnrichment>();
  let tokenAccum = 0;

  let position = 0;
  for (const comm of communities) {
    position++;
    onProgress?.(position, communities.length);

    const members = memberMap.get(comm.id) ?? [];

    if (members.length === 0) {
      results.set(comm.id, fallbackEnrichment(comm.heuristicLabel));
      continue;
    }

    try {
      const promptText = composePrompt(members, comm.heuristicLabel);
      const reply = await llmClient.generate(promptText);

      tokenAccum += estimateTokens(promptText) + estimateTokens(reply);

      results.set(comm.id, decodeResponse(reply, comm.heuristicLabel));
    } catch (err) {
      console.warn(`Failed to enrich cluster ${comm.id}:`, err);
      results.set(comm.id, fallbackEnrichment(comm.heuristicLabel));
    }
  }

  return { enrichments: results, tokensUsed: tokenAccum };
};

// -- Batched enrichment ------------------------------------------------------

/**
 * Label multiple modules per LLM call for higher throughput.
 * Falls back to heuristic labels when the response cannot be parsed.
 */
export const labelModulesBatch = async (
  communities: CommunityNode[],
  memberMap: Map<string, ClusterMemberInfo[]>,
  llmClient: LLMClient,
  batchSize: number = 5,
  onProgress?: (current: number, total: number) => void,
): Promise<EnrichmentResult> => {
  const results = new Map<string, ClusterEnrichment>();
  let tokenAccum = 0;

  let cursor = 0;
  while (cursor < communities.length) {
    const chunk = communities.slice(cursor, cursor + batchSize);
    cursor += batchSize;

    onProgress?.(Math.min(cursor, communities.length), communities.length);

    // Assemble a multi-cluster prompt for this chunk
    const segments = chunk.map((comm, localIdx) => {
      const members = memberMap.get(comm.id) ?? [];
      const capped = members.slice(0, 15);
      const listing = capped.map((m) => `${m.name} (${m.type})`).join(', ');

      return [
        `Cluster ${localIdx + 1} (id: ${comm.id}):`,
        `Heuristic: "${comm.heuristicLabel}"`,
        `Members: ${listing}`,
      ].join('\n');
    });

    const fullPrompt = [
      'Analyze these code clusters and generate semantic names, keywords, and descriptions.',
      '',
      segments.join('\n\n'),
      '',
      'Output JSON array:',
      '[',
      '  {"id": "comm_X", "name": "...", "keywords": [...], "description": "..."},',
      '  ...',
      ']',
    ].join('\n');

    try {
      const reply = await llmClient.generate(fullPrompt);
      tokenAccum += estimateTokens(fullPrompt) + estimateTokens(reply);

      const arrayFragment = reply.match(/\[[\s\S]*\]/);
      if (arrayFragment) {
        const items = JSON.parse(arrayFragment[0]) as Array<{
          id: string;
          name: string;
          keywords: string[];
          description: string;
        }>;

        for (const entry of items) {
          results.set(entry.id, {
            name: entry.name,
            keywords: entry.keywords ?? [],
            description: entry.description ?? '',
          });
        }
      }
    } catch (err) {
      console.warn('Module labelling batch failed; using heuristic fallbacks:', err);
      for (const comm of chunk) {
        results.set(comm.id, fallbackEnrichment(comm.heuristicLabel));
      }
    }
  }

  // Fill in any missing communities with heuristic defaults
  for (const comm of communities) {
    if (!results.has(comm.id)) {
      results.set(comm.id, fallbackEnrichment(comm.heuristicLabel));
    }
  }

  return { enrichments: results, tokensUsed: tokenAccum };
};
