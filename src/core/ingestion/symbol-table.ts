export interface SymbolDefinition {
  nodeId: string;
  filePath: string;
  type: string;
}

export interface SymbolTable {
  /** Register a symbol definition. */
  add: (filePath: string, name: string, nodeId: string, type: string) => void;

  /** Exact file-scoped lookup. Returns node ID or undefined. */
  lookupExact: (filePath: string, name: string) => string | undefined;

  /** Project-wide fuzzy lookup (lower confidence). */
  lookupFuzzy: (name: string) => SymbolDefinition[];

  /** Debug stats: tracked file and symbol counts. */
  getStats: () => { fileCount: number; globalSymbolCount: number };

  /** Release all entries. */
  clear: () => void;
}

/* Dual-index symbol table: per-file exact and project-wide fuzzy lookups */
export const createSymbolTable = (): SymbolTable => {
  /* Per-file entries: "filePath::symbolName" -> nodeId */
  const perFileEntries = new Map<string, string>();

  /* Tracked file paths */
  const knownFiles = new Set<string>();

  /* Reverse index: name -> definitions across all files */
  const reverseIndex = new Map<string, SymbolDefinition[]>();

  const composeKey = (fp: string, sym: string): string =>
    `${fp}::${sym}`;

  const add = (filePath: string, name: string, nodeId: string, type: string): void => {
    knownFiles.add(filePath);

    const compositeKey = composeKey(filePath, name);
    perFileEntries.set(compositeKey, nodeId);

    const entry: SymbolDefinition = { nodeId, filePath, type };
    const existing = reverseIndex.get(name);
    if (existing === undefined) {
      reverseIndex.set(name, [entry]);
    } else {
      existing.push(entry);
    }
  };

  const lookupExact = (filePath: string, name: string): string | undefined => {
    const compositeKey = composeKey(filePath, name);
    return perFileEntries.get(compositeKey);
  };

  const lookupFuzzy = (name: string): SymbolDefinition[] =>
    reverseIndex.get(name) ?? [];

  const getStats = (): { fileCount: number; globalSymbolCount: number } => ({
    fileCount: knownFiles.size,
    globalSymbolCount: reverseIndex.size,
  });

  const clear = (): void => {
    perFileEntries.clear();
    knownFiles.clear();
    reverseIndex.clear();
  };

  return { add, lookupExact, lookupFuzzy, getStats, clear };
};
