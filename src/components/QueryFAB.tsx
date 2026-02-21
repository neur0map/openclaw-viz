import { useState, useRef, useEffect, useCallback } from 'react';
import { Database, Play, X, ChevronDown, ChevronUp, Loader2, Code, Table } from 'lucide-react';
import { useAppState } from '../hooks/useAppState';

const PRESET_QUERIES = [
  { title: 'Functions', cypher: `MATCH (n:Function) RETURN n.id AS id, n.name AS name, n.filePath AS path LIMIT 50` },
  { title: 'Classes', cypher: `MATCH (n:Class) RETURN n.id AS id, n.name AS name, n.filePath AS path LIMIT 50` },
  { title: 'Interfaces', cypher: `MATCH (n:Interface) RETURN n.id AS id, n.name AS name, n.filePath AS path LIMIT 50` },
  { title: 'Call Graph', cypher: `MATCH (a:File)-[r:CodeEdge {type: 'CALLS'}]->(b:Function) RETURN a.id AS id, a.name AS caller, b.name AS callee LIMIT 50` },
  { title: 'Imports', cypher: `MATCH (a:File)-[r:CodeEdge {type: 'IMPORTS'}]->(b:File) RETURN a.id AS id, a.name AS from, b.name AS imports LIMIT 50` },
];

const NODE_ID_RE = /^(File|Function|Class|Method|Interface|Folder|CodeElement):/;

function extractNodeIds(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();

  for (const row of rows) {
    if (Array.isArray(row)) {
      for (const cell of row) {
        if (typeof cell === 'string' && (NODE_ID_RE.test(cell) || cell.includes(':'))) {
          seen.add(cell);
        }
      }
    } else if (typeof row === 'object' && row !== null) {
      for (const [key, val] of Object.entries(row)) {
        if (typeof val !== 'string') continue;
        const k = key.toLowerCase();
        if (k.includes('id') || k === 'id' || NODE_ID_RE.test(val)) {
          seen.add(val);
        }
      }
    }
  }

  return Array.from(seen);
}

function ResultsTable({ rows, maxDisplay }: { rows: Record<string, unknown>[]; maxDisplay: number }) {
  const headers = Object.keys(rows[0]);
  const visible = rows.slice(0, maxDisplay);

  return (
    <div className="max-h-48 overflow-auto scrollbar-thin border-t border-border-subtle">
      <table className="w-full text-xs">
        <thead className="bg-surface sticky top-0">
          <tr>
            {headers.map(h => (
              <th key={h} className="px-3 py-2 text-left text-text-muted font-medium border-b border-border-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr key={ri} className="hover:bg-hover/50 transition-colors">
              {Object.values(row).map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-text-secondary border-b border-border-subtle/50 font-mono truncate max-w-[200px]">
                  {typeof cell === 'object' ? JSON.stringify(cell) : String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxDisplay && (
        <div className="px-3 py-2 text-xs text-text-muted bg-surface border-t border-border-subtle">
          Showing {maxDisplay} of {rows.length} rows
        </div>
      )}
    </div>
  );
}

export const QueryFAB = () => {
  const {
    setHighlightedNodeIds,
    setQueryResult,
    queryResult,
    clearQueryHighlights,
    graph,
    runQuery,
    isDatabaseReady,
  } = useAppState();

  const [panelOpen, setPanelOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [executing, setExecuting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [presetsVisible, setPresetsVisible] = useState(false);
  const [tableVisible, setTableVisible] = useState(true);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelOpen && inputRef.current) inputRef.current.focus();
  }, [panelOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPresetsVisible(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelOpen) {
        setPanelOpen(false);
        setPresetsVisible(false);
      }
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [panelOpen]);

  const executeQuery = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || executing) return;

    if (!graph) {
      setErrorMsg('No project loaded. Load a project first.');
      return;
    }

    const dbReady = await isDatabaseReady();
    if (!dbReady) {
      setErrorMsg('Database not ready. Please wait for loading to complete.');
      return;
    }

    setExecuting(true);
    setErrorMsg(null);

    const t0 = performance.now();

    try {
      const rows = await runQuery(trimmed);
      const elapsed = performance.now() - t0;
      const nodeIds = extractNodeIds(rows);

      setQueryResult({ rows, nodeIds, executionTime: elapsed });
      setHighlightedNodeIds(new Set(nodeIds));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Query execution failed');
      setQueryResult(null);
      setHighlightedNodeIds(new Set());
    } finally {
      setExecuting(false);
    }
  }, [inputText, executing, graph, isDatabaseReady, runQuery, setHighlightedNodeIds, setQueryResult]);

  const onTextareaKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeQuery();
    }
  };

  const pickPreset = (cypher: string) => {
    setInputText(cypher);
    setPresetsVisible(false);
    inputRef.current?.focus();
  };

  const closePanel = () => {
    setPanelOpen(false);
    setPresetsVisible(false);
    clearQueryHighlights();
    setErrorMsg(null);
  };

  const resetInput = () => {
    setInputText('');
    clearQueryHighlights();
    setErrorMsg(null);
    inputRef.current?.focus();
  };

  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        className="group absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2 glass-elevated rounded-md text-text-primary text-[12px] hover:bg-white/[0.14] transition-all duration-200"
      >
        <Database className="w-3.5 h-3.5" />
        <span>Console</span>
        {queryResult && queryResult.nodeIds.length > 0 && (
          <span className="px-1.5 py-0.5 ml-1 bg-white/20 rounded-md text-xs font-semibold">
            {queryResult.nodeIds.length}
          </span>
        )}
      </button>
    );
  }

  const hasResults = queryResult && !errorMsg;
  const highlightCount = queryResult?.nodeIds.length ?? 0;

  return (
    <div
      ref={wrapperRef}
      className="absolute top-4 left-4 z-20 w-[480px] max-w-[calc(100%-2rem)] bg-deep/95 backdrop-blur-md glass-elevated rounded-lg animate-fade-in"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex items-center justify-center bg-white/[0.08] border border-white/[0.12] rounded-md">
            <Database className="w-4 h-4 text-text-secondary" />
          </div>
          <span className="font-medium text-sm">Graph Console</span>
        </div>
        <button
          onClick={closePanel}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={onTextareaKey}
            placeholder="MATCH (n:Function) RETURN n.name, n.filePath LIMIT 10"
            rows={3}
            className="w-full px-3 py-2.5 bg-surface border border-border-subtle rounded-lg text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 outline-none resize-none transition-all"
          />
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="relative">
            <button
              onClick={() => setPresetsVisible(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-colors"
            >
              <Code className="w-3.5 h-3.5" />
              <span>Examples</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${presetsVisible ? 'rotate-180' : ''}`} />
            </button>

            {presetsVisible && (
              <div className="absolute bottom-full left-0 mb-2 w-64 py-1 bg-surface border border-border-subtle rounded-lg shadow-xl animate-fade-in">
                {PRESET_QUERIES.map(p => (
                  <button
                    key={p.title}
                    onClick={() => pickPreset(p.cypher)}
                    className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {inputText && (
              <button
                onClick={resetInput}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={executeQuery}
              disabled={!inputText.trim() || executing}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-accent rounded-md text-white text-[13px] hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Run</span>
              <kbd className="ml-1 px-1 py-0.5 bg-white/20 rounded text-[10px]">⌘↵</kbd>
            </button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20">
          <p className="text-xs text-red-400 font-mono">{errorMsg}</p>
        </div>
      )}

      {hasResults && (
        <div className="border-t border-violet-500/20">
          <div className="px-4 py-2.5 bg-violet-500/5 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className="text-text-secondary">
                <span className="text-violet-400 font-semibold">{queryResult.rows.length}</span> rows
              </span>
              {highlightCount > 0 && (
                <span className="text-text-secondary">
                  <span className="text-violet-400 font-semibold">{highlightCount}</span> highlighted
                </span>
              )}
              <span className="text-text-muted">{queryResult.executionTime.toFixed(1)}ms</span>
            </div>
            <div className="flex items-center gap-2">
              {highlightCount > 0 && (
                <button
                  onClick={clearQueryHighlights}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setTableVisible(v => !v)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                <Table className="w-3 h-3" />
                {tableVisible ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {tableVisible && queryResult.rows.length > 0 && (
            <ResultsTable rows={queryResult.rows} maxDisplay={50} />
          )}
        </div>
      )}
    </div>
  );
};
