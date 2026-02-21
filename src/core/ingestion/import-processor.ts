import { CodeGraph } from '../graph/types';
import { ASTCache } from './ast-cache';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { getLanguageFromFilename } from './utils';

// Per-file set of resolved dependency paths
export type ImportMap = Map<string, Set<string>>;

export const createImportMap = (): ImportMap => new Map();

// Extension candidates tried when resolving an import specifier
const PROBE_SUFFIXES = [
  '',
  '.tsx', '.ts', '.jsx', '.js',
  '/index.tsx', '/index.ts', '/index.jsx', '/index.js',
  '.py', '/__init__.py',
  '.java',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.hh',
  '.cs',
  '.go',
  '.rs', '/mod.rs',
];

/** Resolve an import specifier to a project file path, or null if external. */
const toConcreteFile = (
  originFile: string,
  specifier: string,
  knownFiles: Set<string>,
  fileList: string[],
  memo: Map<string, string | null>
): string | null => {
  const memoKey = originFile + '::' + specifier;
  if (memo.has(memoKey)) return memo.get(memoKey)!;

  // Resolve relative path segments
  const dirParts = originFile.split('/').slice(0, -1);
  specifier.split('/').forEach(seg => {
    if (seg === '.') return;
    if (seg === '..') { dirParts.pop(); return; }
    dirParts.push(seg);
  });
  const resolvedBase = dirParts.join('/');

  // Relative imports
  if (specifier.charAt(0) === '.') {
    for (const suffix of PROBE_SUFFIXES) {
      const attempt = resolvedBase + suffix;
      if (knownFiles.has(attempt)) {
        memo.set(memoKey, attempt);
        return attempt;
      }
    }
    memo.set(memoKey, null);
    return null;
  }

  // Wildcard imports cannot resolve to a single file
  if (specifier.endsWith('.*')) {
    memo.set(memoKey, null);
    return null;
  }

  // Package-style imports: convert dots to slashes and probe
  const normalized = specifier.includes('/') ? specifier : specifier.replace(/\./g, '/');
  const chunks = normalized.split('/').filter(Boolean);
  const fwdSlashPaths = fileList.map(fp => fp.replace(/\\/g, '/'));

  let chunkOffset = 0;
  while (chunkOffset < chunks.length) {
    const tail = chunks.slice(chunkOffset).join('/');
    for (const suffix of PROBE_SUFFIXES) {
      const needle = '/' + tail + suffix;
      const matchPos = fwdSlashPaths.findIndex(
        fp => fp.endsWith(needle) || fp.toLowerCase().endsWith(needle.toLowerCase())
      );
      if (matchPos !== -1) {
        const found = fileList[matchPos];
        memo.set(memoKey, found);
        return found;
      }
    }
    chunkOffset++;
  }

  memo.set(memoKey, null);
  return null;
};

export const processImports = async (
  graph: CodeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void
) => {
  const allPaths = new Set(files.map(f => f.path));
  const pathList = files.map(f => f.path);
  const parser = await loadParser();
  const resolutionMemo = new Map<string, string | null>();

  let discoveredCount = 0;
  let linkedCount = 0;

  let cursor = 0;
  while (cursor < files.length) {
    const entry = files[cursor];
    onProgress?.(cursor + 1, files.length);

    const lang = getLanguageFromFilename(entry.path);
    if (!lang) { cursor++; continue; }

    const queryText = LANGUAGE_QUERIES[lang];
    if (!queryText) { cursor++; continue; }

    await loadLanguage(lang, entry.path);

    let syntaxTree = astCache.get(entry.path);
    let ephemeral = false;
    if (!syntaxTree) {
      syntaxTree = parser.parse(entry.content);
      ephemeral = true;
    }

    let queryHandle;
    let matchList;
    try {
      queryHandle = parser.getLanguage().query(queryText);
      matchList = queryHandle.matches(syntaxTree.rootNode);
    } catch (_err: any) {
      if (ephemeral) syntaxTree.delete();
      cursor++;
      continue;
    }

    matchList.forEach(m => {
      const captured: Record<string, any> = {};
      m.captures.forEach(c => { captured[c.name] = c.node; });

      if (!captured['import']) return;

      const srcNode = captured['import.source'];
      if (!srcNode) {
        if (import.meta.env.DEV) {
          console.log(`[prowl:imports] captured import with no source node in ${entry.path}`);
        }
        return;
      }

      const rawSpec = srcNode.text.replace(/['"]/g, '');
      discoveredCount++;

      const concrete = toConcreteFile(entry.path, rawSpec, allPaths, pathList, resolutionMemo);
      if (!concrete) return;

      linkedCount++;

      const fromId = generateId('File', entry.path);
      const toId = generateId('File', concrete);
      const edgeId = generateId('IMPORTS', `${entry.path}->${concrete}`);

      graph.addRelationship({
        id: edgeId,
        sourceId: fromId,
        targetId: toId,
        type: 'IMPORTS',
        confidence: 1.0,
        reason: '',
      });

      if (!importMap.has(entry.path)) {
        importMap.set(entry.path, new Set());
      }
      importMap.get(entry.path)!.add(concrete);
    });

    if (ephemeral) {
      syntaxTree.delete();
    }
    cursor++;
  }

  if (import.meta.env.DEV) {
    console.log(`[prowl:imports] ${linkedCount}/${discoveredCount} imports resolved to graph edges`);
  }
};
