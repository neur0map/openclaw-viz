/**
 * Creates EXTENDS and IMPLEMENTS edges for class/struct/trait
 * inheritance and interface conformance.
 */

import { CodeGraph } from '../graph/types';
import { ASTCache } from './ast-cache';
import { SymbolTable } from './symbol-table';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { getLanguageFromFilename } from './utils';

/** Resolve a symbol to a node ID (exact match first, then fuzzy global). */
const resolveSymbol = (
  symbols: SymbolTable,
  filePath: string,
  name: string,
  fallbackLabel: string
): string => {
  const exactHit = symbols.lookupExact(filePath, name);
  if (exactHit) return exactHit;

  const fuzzyHits = symbols.lookupFuzzy(name);
  if (fuzzyHits.length > 0) return fuzzyHits[0].nodeId;

  return generateId(fallbackLabel, filePath ? `${filePath}:${name}` : name);
};

/** Resolve an external parent/trait via fuzzy global lookup, or generate an ID. */
const resolveExternalSymbol = (
  symbols: SymbolTable,
  name: string,
  fallbackLabel: string
): string => {
  const hits = symbols.lookupFuzzy(name);
  return hits.length > 0 ? hits[0].nodeId : generateId(fallbackLabel, name);
};

export const processHeritage = async (
  graph: CodeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  symbolTable: SymbolTable,
  onProgress?: (current: number, total: number) => void
) => {
  const parser = await loadParser();
  const totalEntries = files.length;

  let pos = 0;
  while (pos < totalEntries) {
    const entry = files[pos];
    onProgress?.(pos + 1, totalEntries);

    const lang = getLanguageFromFilename(entry.path);
    if (!lang) { pos++; continue; }

    const queryText = LANGUAGE_QUERIES[lang];
    if (!queryText) { pos++; continue; }

    await loadLanguage(lang, entry.path);

    let syntaxTree = astCache.get(entry.path);
    let disposable = false;
    if (!syntaxTree) {
      syntaxTree = parser.parse(entry.content);
      disposable = true;
    }

    let queryHandle;
    let matchResults;
    try {
      queryHandle = parser.getLanguage().query(queryText);
      matchResults = queryHandle.matches(syntaxTree.rootNode);
    } catch (err) {
      console.warn(`Heritage query error for ${entry.path}:`, err);
      if (disposable) syntaxTree.delete();
      pos++;
      continue;
    }

    for (const m of matchResults) {
      const captured: Record<string, any> = {};
      m.captures.forEach(cap => { captured[cap.name] = cap.node; });

      const classNode = captured['heritage.class'];
      const extendsNode = captured['heritage.extends'];
      const implementsNode = captured['heritage.implements'];
      const traitNode = captured['heritage.trait'];

      // Inheritance: class/struct extends a base
      if (classNode && extendsNode) {
        const derivedName = classNode.text;
        const baseName = extendsNode.text;

        const derivedId = resolveSymbol(symbolTable, entry.path, derivedName, 'Class');
        const baseId = resolveExternalSymbol(symbolTable, baseName, 'Class');

        if (derivedId !== baseId) {
          const edgeKey = generateId('EXTENDS', `${derivedId}->${baseId}`);
          graph.addRelationship({
            id: edgeKey,
            sourceId: derivedId,
            targetId: baseId,
            type: 'EXTENDS',
            confidence: 1.0,
            reason: '',
          });
        }
      }

      // Conformance: class implements an interface
      if (classNode && implementsNode) {
        const typeName = classNode.text;
        const contractName = implementsNode.text;

        const typeId = resolveSymbol(symbolTable, entry.path, typeName, 'Class');
        const contractId = resolveExternalSymbol(symbolTable, contractName, 'Interface');

        if (typeId && contractId) {
          const edgeKey = generateId('IMPLEMENTS', `${typeId}->${contractId}`);
          graph.addRelationship({
            id: edgeKey,
            sourceId: typeId,
            targetId: contractId,
            type: 'IMPLEMENTS',
            confidence: 1.0,
            reason: '',
          });
        }
      }

      // Rust: impl Trait for Struct
      if (traitNode && classNode) {
        const concreteName = classNode.text;
        const traitName = traitNode.text;

        const concreteId = resolveSymbol(symbolTable, entry.path, concreteName, 'Struct');
        const traitId = resolveExternalSymbol(symbolTable, traitName, 'Trait');

        if (concreteId && traitId) {
          const edgeKey = generateId('IMPLEMENTS', `${concreteId}->${traitId}`);
          graph.addRelationship({
            id: edgeKey,
            sourceId: concreteId,
            targetId: traitId,
            type: 'IMPLEMENTS',
            confidence: 1.0,
            reason: 'trait-impl',
          });
        }
      }
    }

    if (disposable) {
      syntaxTree.delete();
    }
    pos++;
  }
};
