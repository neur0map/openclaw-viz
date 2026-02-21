import { CodeGraph } from '../graph/types';
import { ASTCache } from './ast-cache';
import { SymbolTable } from './symbol-table';
import { ImportMap } from './import-processor';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { getLanguageFromFilename } from './utils';

// Standard library and language built-in names excluded from call resolution
const WELL_KNOWN_NAMES: Set<string> = new Set([
  // JS/TS runtime
  'console', 'log', 'warn', 'error', 'info', 'debug',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'JSON', 'parse', 'stringify',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'resolve', 'reject', 'then', 'catch', 'finally',
  'Math', 'Date', 'RegExp', 'Error',
  'require', 'import', 'export',
  'fetch', 'Response', 'Request',
  // React hooks
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useContext',
  'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue',
  'createElement', 'createContext', 'createRef', 'forwardRef', 'memo', 'lazy',
  // Iteration helpers
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'includes', 'indexOf', 'slice', 'splice', 'concat', 'join', 'split',
  'push', 'pop', 'shift', 'unshift', 'sort', 'reverse',
  'keys', 'values', 'entries', 'assign', 'freeze', 'seal',
  'hasOwnProperty', 'toString', 'valueOf',
  // Python stdlib
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
  'open', 'read', 'write', 'close', 'append', 'extend', 'update',
  'super', 'type', 'isinstance', 'issubclass', 'getattr', 'setattr', 'hasattr',
  'enumerate', 'zip', 'sorted', 'reversed', 'min', 'max', 'sum', 'abs',
]);

// AST node kinds that delimit callable scopes
const CALLABLE_BOUNDARIES: Set<string> = new Set([
  'function_declaration',
  'arrow_function',
  'function_expression',
  'method_definition',
  'generator_function_declaration',
  'function_definition',
  'async_function_declaration',
  'async_arrow_function',
  'method_declaration',
  'constructor_declaration',
  'local_function_statement',
  'function_item',
  'impl_item',
]);

/**
 * Resolution outcome carrying confidence metadata.
 */
interface ResolveResult {
  nodeId: string;
  confidence: number;
  reason: string;
}

/**
 * Determine whether a name belongs to the standard library or language primitives.
 */
const belongsToRuntime = (identifier: string): boolean => WELL_KNOWN_NAMES.has(identifier);

/**
 * Walk up from a call site to locate the nearest enclosing callable.
 * Returns the graph node ID for that callable, or null for top-level code.
 */
const locateEnclosingCallable = (
  callNode: any,
  srcPath: string,
  symbols: SymbolTable
): string | null => {
  let ancestor = callNode.parent;

  while (ancestor) {
    if (!CALLABLE_BOUNDARIES.has(ancestor.type)) {
      ancestor = ancestor.parent;
      continue;
    }

    let callableName: string | null = null;
    let graphLabel = 'Function';

    switch (ancestor.type) {
      case 'function_declaration':
      case 'function_definition':
      case 'async_function_declaration':
      case 'generator_function_declaration':
      case 'function_item': {
        const nameChild = ancestor.childForFieldName?.('name') ??
          ancestor.children?.find((c: any) => c.type === 'identifier' || c.type === 'property_identifier');
        callableName = nameChild?.text ?? null;
        break;
      }
      case 'impl_item': {
        const innerFn = ancestor.children?.find((c: any) => c.type === 'function_item');
        if (innerFn) {
          const nameChild = innerFn.childForFieldName?.('name') ??
            innerFn.children?.find((c: any) => c.type === 'identifier');
          callableName = nameChild?.text ?? null;
          graphLabel = 'Method';
        }
        break;
      }
      case 'method_definition': {
        const nameChild = ancestor.childForFieldName?.('name') ??
          ancestor.children?.find((c: any) => c.type === 'property_identifier');
        callableName = nameChild?.text ?? null;
        graphLabel = 'Method';
        break;
      }
      case 'method_declaration':
      case 'constructor_declaration': {
        const nameChild = ancestor.childForFieldName?.('name') ??
          ancestor.children?.find((c: any) => c.type === 'identifier');
        callableName = nameChild?.text ?? null;
        graphLabel = 'Method';
        break;
      }
      case 'arrow_function':
      case 'function_expression': {
        const varDecl = ancestor.parent;
        if (varDecl?.type === 'variable_declarator') {
          const nameChild = varDecl.childForFieldName?.('name') ??
            varDecl.children?.find((c: any) => c.type === 'identifier');
          callableName = nameChild?.text ?? null;
        }
        break;
      }
      default:
        break;
    }

    if (callableName) {
      const exactId = symbols.lookupExact(srcPath, callableName);
      if (exactId) return exactId;
      return generateId(graphLabel, `${srcPath}:${callableName}`);
    }

    ancestor = ancestor.parent;
  }

  return null;
};

/**
 * Resolve a called identifier to the most likely target node using a tiered strategy.
 * Priority: imported symbols > same-file symbols > project-wide fuzzy match.
 */
const findTarget = (
  identifier: string,
  callerFile: string,
  symbols: SymbolTable,
  imports: ImportMap
): ResolveResult | null => {
  // Tier 1: Look in files that the caller explicitly imports
  const importedSources = imports.get(callerFile);
  if (importedSources) {
    for (const dep of importedSources) {
      const hit = symbols.lookupExact(dep, identifier);
      if (hit) {
        return { nodeId: hit, confidence: 0.9, reason: 'import-resolved' };
      }
    }
  }

  // Tier 2: Defined in the same file
  const sameFileHit = symbols.lookupExact(callerFile, identifier);
  if (sameFileHit) {
    return { nodeId: sameFileHit, confidence: 0.85, reason: 'same-file' };
  }

  // Tier 3: Global fuzzy search across all files
  const candidates = symbols.lookupFuzzy(identifier);
  if (candidates.length > 0) {
    const conf = candidates.length === 1 ? 0.5 : 0.3;
    return { nodeId: candidates[0].nodeId, confidence: conf, reason: 'fuzzy-global' };
  }

  return null;
};

export const processCalls = async (
  graph: CodeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  symbolTable: SymbolTable,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void
) => {
  const parser = await loadParser();
  const totalFiles = files.length;

  for (let pos = 0; pos < totalFiles; pos++) {
    const src = files[pos];
    onProgress?.(pos + 1, totalFiles);

    const lang = getLanguageFromFilename(src.path);
    if (!lang) continue;

    const queryText = LANGUAGE_QUERIES[lang];
    if (!queryText) continue;

    await loadLanguage(lang, src.path);

    let ast = astCache.get(src.path);
    let needsCleanup = false;

    if (!ast) {
      ast = parser.parse(src.content);
      needsCleanup = true;
    }

    let queryHandle;
    let matchList;
    try {
      queryHandle = parser.getLanguage().query(queryText);
      matchList = queryHandle.matches(ast.rootNode);
    } catch (qErr) {
      console.warn(`Query error for ${src.path}:`, qErr);
      if (needsCleanup) ast.delete();
      continue;
    }

    for (const m of matchList) {
      const nodes: Record<string, any> = {};
      m.captures.forEach(c => { nodes[c.name] = c.node; });

      if (!nodes['call']) continue;

      const calleeNode = nodes['call.name'];
      if (!calleeNode) continue;

      const calleeName = calleeNode.text;
      if (belongsToRuntime(calleeName)) continue;

      const target = findTarget(calleeName, src.path, symbolTable, importMap);
      if (!target) continue;

      const callSiteNode = nodes['call'];
      const callerId = locateEnclosingCallable(callSiteNode, src.path, symbolTable)
        ?? generateId('File', src.path);

      const edgeId = generateId('CALLS', `${callerId}:${calleeName}->${target.nodeId}`);

      graph.addRelationship({
        id: edgeId,
        sourceId: callerId,
        targetId: target.nodeId,
        type: 'CALLS',
        confidence: target.confidence,
        reason: target.reason,
      });
    }

    if (needsCleanup) {
      ast.delete();
    }
  }
};
