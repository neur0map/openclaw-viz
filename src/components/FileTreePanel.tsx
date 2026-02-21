import { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode,
  Search,
  Filter,
  PanelLeftClose,
  PanelLeft,
  Box,
  Braces,
  Variable,
  Hash,
  Target,
} from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { FILTERABLE_LABELS, NODE_COLORS, ALL_EDGE_TYPES, EDGE_INFO, type EdgeType } from '../lib/constants';
import { GraphNode, NodeLabel } from '../core/graph/types';
import { getFileIcon } from '../lib/file-icons';

interface FsNode {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  fullPath: string;
  subtree: FsNode[];
  source?: GraphNode;
}

function assembleTree(nodes: GraphNode[]): FsNode[] {
  const trunk: FsNode[] = [];
  const registry = new Map<string, FsNode>();

  const fsNodes = nodes
    .filter(n => n.label === 'Folder' || n.label === 'File')
    .sort((a, b) => a.properties.filePath.localeCompare(b.properties.filePath));

  for (const gn of fsNodes) {
    const segments = gn.properties.filePath.split('/').filter(Boolean);
    let trail = '';
    let level = trunk;

    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      trail = trail ? `${trail}/${seg}` : seg;

      let entry = registry.get(trail);
      if (!entry) {
        const isTail = idx === segments.length - 1;
        const isFileTail = isTail && gn.label === 'File';

        entry = {
          id: isTail ? gn.id : trail,
          name: seg,
          kind: isFileTail ? 'file' : 'folder',
          fullPath: trail,
          subtree: [],
          source: isTail ? gn : undefined,
        };

        registry.set(trail, entry);
        level.push(entry);
      }

      level = entry.subtree;
    }
  }

  return trunk;
}

function gatherFileIds(fsNode: FsNode): string[] {
  const collected: string[] = [];
  if (fsNode.kind === 'file' && fsNode.source) {
    collected.push(fsNode.source.id);
  }
  for (const child of fsNode.subtree) {
    collected.push(...gatherFileIds(child));
  }
  return collected;
}

const NODE_TYPE_ICONS: Record<string, typeof Folder> = {
  Folder: Folder,
  File: FileCode,
  Class: Box,
  Function: Braces,
  Method: Braces,
  Interface: Hash,
  Import: FileCode,
};

function iconForLabel(label: NodeLabel) {
  return NODE_TYPE_ICONS[label] ?? Variable;
}

function FsTreeRow({
  entry,
  indent,
  filter,
  onPick,
  openPaths,
  onToggle,
  activePath,
}: {
  entry: FsNode;
  indent: number;
  filter: string;
  onPick: (n: FsNode) => void;
  openPaths: Set<string>;
  onToggle: (p: string) => void;
  activePath: string | null;
}) {
  const expanded = openPaths.has(entry.fullPath);
  const selected = activePath === entry.fullPath;
  const hasKids = entry.subtree.length > 0;

  const childrenRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(expanded);
  const [height, setHeight] = useState<number | 'auto'>(expanded ? 'auto' : 0);

  useLayoutEffect(() => {
    if (expanded) setRendered(true);
  }, [expanded]);

  useLayoutEffect(() => {
    if (!childrenRef.current) return;
    if (expanded && rendered) {
      setHeight(0);
      requestAnimationFrame(() => {
        if (!childrenRef.current) return;
        const h = childrenRef.current.scrollHeight;
        requestAnimationFrame(() => setHeight(h));
      });
    } else if (!expanded && rendered) {
      const h = childrenRef.current.scrollHeight;
      setHeight(h);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
    }
  }, [expanded, rendered]);

  const handleTransitionEnd = () => {
    if (!expanded) setRendered(false);
    if (expanded) setHeight('auto');
  };

  const visibleChildren = useMemo(() => {
    if (!filter) return entry.subtree;
    const lowerFilter = filter.toLowerCase();
    return entry.subtree.filter(c =>
      c.name.toLowerCase().includes(lowerFilter) ||
      c.subtree.some(gc => gc.name.toLowerCase().includes(lowerFilter))
    );
  }, [entry.subtree, filter]);

  const nameMatches = filter.length > 0 && entry.name.toLowerCase().includes(filter.toLowerCase());

  const rowClasses = [
    'w-full flex items-center gap-1.5 px-2 py-1 text-left text-sm',
    'hover:bg-hover transition-colors rounded relative border-l-2',
    selected ? 'bg-amber-500/15 text-amber-300 border-amber-400' : 'text-text-secondary hover:text-text-primary border-transparent',
    nameMatches ? 'bg-accent/10' : '',
  ].join(' ');

  return (
    <div>
      <button
        onClick={() => { if (hasKids) onToggle(entry.fullPath); onPick(entry); }}
        className={rowClasses}
        style={{ paddingLeft: `${indent * 12 + 8}px` }}
      >
        {hasKids ? (
          <ChevronRight
            className="w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150 ease-out"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        ) : (
          <span className="w-3.5" />
        )}

        {entry.kind === 'folder' ? (
          expanded
            ? <FolderOpen className="w-4 h-4 shrink-0" style={{ color: NODE_COLORS.Folder }} />
            : <Folder className="w-4 h-4 shrink-0" style={{ color: NODE_COLORS.Folder }} />
        ) : (
          <FileCode className="w-4 h-4 shrink-0" style={{ color: getFileIcon(entry.name).color }} />
        )}

        <span className="truncate font-mono text-xs">{entry.name}</span>
      </button>

      {hasKids && rendered && (
        <div
          ref={childrenRef}
          onTransitionEnd={handleTransitionEnd}
          style={{
            height: height === 'auto' ? 'auto' : `${height}px`,
            opacity: expanded ? 1 : 0,
            overflow: 'hidden',
            transition: height === 'auto' ? 'none' : 'height 150ms ease-out, opacity 150ms ease-out',
          }}
        >
          {visibleChildren.map(child => (
            <FsTreeRow
              key={child.id}
              entry={child}
              indent={indent + 1}
              filter={filter}
              onPick={onPick}
              openPaths={openPaths}
              onToggle={onToggle}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreePanelProps {
  onFocusNode: (nodeId: string) => void;
}

export const FileTreePanel = ({ onFocusNode }: FileTreePanelProps) => {
  const {
    graph,
    visibleLabels,
    toggleLabelVisibility,
    visibleEdgeTypes,
    toggleEdgeVisibility,
    selectedNode,
    setSelectedNode,
    openCodePanel,
    depthFilter,
    setDepthFilter,
    setHighlightedNodeIds,
  } = useAppState();

  const [panelHidden, setPanelHidden] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'files' | 'filters'>('filters');

  const tree = useMemo(() => {
    if (!graph) return [];
    return assembleTree(graph.nodes);
  }, [graph]);

  useEffect(() => {
    if (tree.length > 0 && openPaths.size === 0) {
      setOpenPaths(new Set(tree.map(n => n.fullPath)));
    }
  }, [tree.length]);

  useEffect(() => {
    const fp = selectedNode?.properties?.filePath;
    if (!fp) return;

    const parts = fp.split('/').filter(Boolean);
    const ancestors: string[] = [];
    let accum = '';
    for (let i = 0; i < parts.length - 1; i++) {
      accum = accum ? `${accum}/${parts[i]}` : parts[i];
      ancestors.push(accum);
    }

    if (ancestors.length > 0) {
      setOpenPaths(prev => {
        const updated = new Set(prev);
        ancestors.forEach(a => updated.add(a));
        return updated;
      });
    }
  }, [selectedNode?.id]);

  const togglePath = useCallback((path: string) => {
    setOpenPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handlePick = useCallback((fsNode: FsNode) => {
    if (fsNode.kind === 'folder') {
      const childIds = gatherFileIds(fsNode);
      if (childIds.length > 0) setHighlightedNodeIds(new Set(childIds));
    } else if (fsNode.source) {
      const alreadySelected = selectedNode?.id === fsNode.source.id;
      setSelectedNode(fsNode.source);
      openCodePanel();
      if (!alreadySelected) onFocusNode(fsNode.source.id);
    }
  }, [setSelectedNode, openCodePanel, onFocusNode, selectedNode, setHighlightedNodeIds]);

  const currentPath = selectedNode?.properties.filePath || null;

  if (panelHidden) {
    return (
      <div className="h-full w-12 bg-surface border-r border-border-subtle flex flex-col items-center py-3 gap-2">
        <button
          onClick={() => setPanelHidden(false)}
          className="p-2 text-text-secondary hover:text-text-primary hover:bg-hover rounded transition-colors"
          title="Expand Panel"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
        <div className="w-6 h-px bg-border-subtle my-1" />
        <button
          onClick={() => { setPanelHidden(false); setTab('files'); }}
          className={`p-2 rounded transition-colors ${tab === 'files' ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary hover:bg-hover'}`}
          title="File Explorer"
        >
          <Folder className="w-5 h-5" />
        </button>
        <button
          onClick={() => { setPanelHidden(false); setTab('filters'); }}
          className={`p-2 rounded transition-colors ${tab === 'filters' ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text-primary hover:bg-hover'}`}
          title="Filters"
        >
          <Filter className="w-5 h-5" />
        </button>
      </div>
    );
  }

  const depthOptions = [
    { val: null as number | null, text: 'All' },
    { val: 1, text: '1 hop' },
    { val: 2, text: '2 hops' },
    { val: 3, text: '3 hops' },
    { val: 5, text: '5 hops' },
  ];

  const legendLabels: NodeLabel[] = ['Folder', 'File', 'Class', 'Function', 'Interface', 'Method'];

  return (
    <div className="h-full w-64 bg-void border-r border-white/[0.08] flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-1">
          {(['filters', 'files'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                tab === t
                  ? 'bg-white/[0.1] text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-hover'
              }`}
            >
              {t === 'filters' ? 'Graph' : 'Files'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPanelHidden(true)}
          className="p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
          title="Collapse Panel"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {tab === 'files' && (
        <>
          <div className="px-3 py-2 border-b border-border-subtle">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Search files..."
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-elevated border border-border-subtle rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
            {tree.length === 0 ? (
              <div className="px-3 py-4 text-center text-text-muted text-xs">No files loaded</div>
            ) : (
              tree.map(node => (
                <FsTreeRow
                  key={node.id}
                  entry={node}
                  indent={0}
                  filter={filterText}
                  onPick={handlePick}
                  openPaths={openPaths}
                  onToggle={togglePath}
                  activePath={currentPath}
                />
              ))
            )}
          </div>
        </>
      )}

      {tab === 'filters' && (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
          <div className="mb-4">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              <Target className="w-3 h-3 inline mr-1" />
              Hop Depth
            </h3>
            <div className="flex gap-1">
              {depthOptions.map(({ val, text }) => (
                <button
                  key={text}
                  onClick={() => setDepthFilter(val)}
                  className={`flex-1 px-1.5 py-1 text-[10px] rounded transition-colors text-center ${
                    depthFilter === val
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                      : 'bg-white/[0.04] text-text-muted hover:bg-hover border border-transparent'
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            {depthFilter !== null && !selectedNode && (
              <p className="mt-1.5 text-[10px] text-amber-400/80">Select a node first</p>
            )}
          </div>

          <div className="mb-4 flex flex-wrap gap-x-2.5 gap-y-1 px-1">
            {legendLabels.map(label => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-1.5 h-3 rounded-sm" style={{ backgroundColor: NODE_COLORS[label] }} />
                <span className="text-[9px] text-text-muted">{label}</span>
              </div>
            ))}
          </div>

          <div className="mb-1">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Nodes
            </h3>
          </div>

          <div className="flex flex-col gap-0.5">
            {FILTERABLE_LABELS.map(label => {
              const Ico = iconForLabel(label);
              const on = visibleLabels.includes(label);
              return (
                <button
                  key={label}
                  onClick={() => toggleLabelVisibility(label)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                    on ? 'bg-elevated text-text-primary' : 'text-text-muted hover:bg-hover hover:text-text-secondary'
                  }`}
                >
                  <div
                    className={`w-2 h-4 rounded-sm ${on ? '' : 'opacity-30'}`}
                    style={{ backgroundColor: NODE_COLORS[label] }}
                  />
                  <Ico className="w-3.5 h-3.5" style={{ color: on ? NODE_COLORS[label] : undefined }} />
                  <span className="text-xs flex-1">{label}</span>
                  <div className={`w-5 h-3 rounded-full transition-colors flex items-center ${on ? 'bg-white/20 justify-end' : 'bg-white/5 justify-start'}`}>
                    <div className={`w-2.5 h-2.5 rounded-full mx-px transition-colors ${on ? 'bg-white/80' : 'bg-white/20'}`} />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-border-subtle">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
              Edges
            </h3>

            <div className="flex flex-col gap-0.5">
              {ALL_EDGE_TYPES.map(et => {
                const meta = EDGE_INFO[et];
                const on = visibleEdgeTypes.includes(et);
                return (
                  <button
                    key={et}
                    onClick={() => toggleEdgeVisibility(et)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                      on ? 'bg-elevated text-text-primary' : 'text-text-muted hover:bg-hover hover:text-text-secondary'
                    }`}
                  >
                    <div
                      className={`w-4 h-0.5 rounded-full ${on ? '' : 'opacity-30'}`}
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="text-xs flex-1">{meta.label}</span>
                    <div className={`w-5 h-3 rounded-full transition-colors flex items-center ${on ? 'bg-white/20 justify-end' : 'bg-white/5 justify-start'}`}>
                      <div className={`w-2.5 h-2.5 rounded-full mx-px transition-colors ${on ? 'bg-white/80' : 'bg-white/20'}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {graph && (
        <div className="px-3 py-2 border-t border-border-subtle bg-elevated/50">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{graph.nodes.length} nodes</span>
            <span>{graph.relationships.length} edges</span>
          </div>
        </div>
      )}
    </div>
  );
};
