import { LRUCache } from 'lru-cache';
import Parser from 'web-tree-sitter';

/* AST tree cache contract */
export interface ASTCache {
  get: (filePath: string) => Parser.Tree | undefined;
  set: (filePath: string, tree: Parser.Tree) => void;
  clear: () => void;
  stats: () => { size: number; maxSize: number };
}

/* LRU cache that releases WASM tree memory on eviction */
export const createASTCache = (maxSize: number = 50): ASTCache => {
  const capacity = maxSize;

  const treeStore = new LRUCache<string, Parser.Tree>({
    max: capacity,
    dispose: (evictedTree: Parser.Tree) => {
      try {
        evictedTree.delete();
      } catch (_err) {
        console.warn('Unable to release WASM tree memory', _err);
      }
    },
  });

  const retrieve = (filePath: string): Parser.Tree | undefined =>
    treeStore.get(filePath);

  const store = (filePath: string, tree: Parser.Tree): void => {
    treeStore.set(filePath, tree);
  };

  const purge = (): void => {
    treeStore.clear();
  };

  const info = (): { size: number; maxSize: number } => ({
    size: treeStore.size,
    maxSize: capacity,
  });

  return {
    get: retrieve,
    set: store,
    clear: purge,
    stats: info,
  };
};
