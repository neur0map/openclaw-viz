import { useEffect, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Focus, RotateCcw, Play, Pause, Eye, EyeOff } from 'lucide-react';
import { useSigma } from '../hooks/useSigma';
import { useAppState } from '../hooks/useAppState';
import { toSigmaGraph, filterGraphByDepth, NodeDisplayAttrs, EdgeDisplayAttrs } from '../lib/graph-adapter';
import { QueryFAB } from './QueryFAB';
import Graph from 'graphology';

export interface GraphCanvasHandle {
  focusNode: (nodeId: string) => void;
  refreshGraph: () => void;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle>((_, ref) => {
  const {
    graph,
    setSelectedNode,
    selectedNode: appSelectedNode,
    visibleLabels,
    visibleEdgeTypes,
    openCodePanel,
    depthFilter,
    highlightedNodeIds,
    setHighlightedNodeIds,
    aiCitationHighlightedNodeIds,
    aiToolHighlightedNodeIds,
    blastRadiusNodeIds,
    isAIHighlightsEnabled,
    toggleAIHighlights,
    animatedNodes,
  } = useAppState();
  const [hoveredNodeName, setHoveredNodeName] = useState<string | null>(null);

  const effectiveHighlightedNodeIds = useMemo(() => {
    if (!isAIHighlightsEnabled) return highlightedNodeIds;
    const next = new Set(highlightedNodeIds);
    for (const id of aiCitationHighlightedNodeIds) next.add(id);
    for (const id of aiToolHighlightedNodeIds) next.add(id);
    return next;
  }, [highlightedNodeIds, aiCitationHighlightedNodeIds, aiToolHighlightedNodeIds, isAIHighlightsEnabled]);

  // Impact-zone nodes gated by AI highlight toggle
  const highlightedImpactIds = useMemo(() => {
    if (!isAIHighlightsEnabled) return new Set<string>();
    return blastRadiusNodeIds;
  }, [blastRadiusNodeIds, isAIHighlightsEnabled]);

  const effectiveAnimatedNodes = useMemo(() => animatedNodes, [animatedNodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!graph) return;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (node.label === 'Folder') {
      const folderPath = node.properties.filePath;
      const childFileIds = graph.nodes
        .filter(n => n.label === 'File' && n.properties.filePath.startsWith(folderPath + '/'))
        .map(n => n.id);
      if (childFileIds.length > 0) {
        setHighlightedNodeIds(new Set(childFileIds));
      }
    } else {
      setSelectedNode(node);
      openCodePanel();
    }
  }, [graph, setSelectedNode, openCodePanel, setHighlightedNodeIds]);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    if (!nodeId || !graph) {
      setHoveredNodeName(null);
      return;
    }
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      setHoveredNodeName(node.properties.name);
    }
  }, [graph]);

  const handleStageClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const {
    containerRef,
    sigmaRef,
    setGraph: setSigmaGraph,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    isLayoutRunning,
    startLayout,
    stopLayout,
    selectedNode: sigmaSelectedNode,
    setSelectedNode: setSigmaSelectedNode,
  } = useSigma({
    onNodeClick: handleNodeClick,
    onNodeHover: handleNodeHover,
    onStageClick: handleStageClick,
    highlightedNodeIds: effectiveHighlightedNodeIds,
    blastRadiusNodeIds: highlightedImpactIds,
    animatedNodes: effectiveAnimatedNodes,
    visibleEdgeTypes,
  });

  useImperativeHandle(ref, () => ({
    focusNode: (nodeId: string) => {
      setHighlightedNodeIds(new Set([nodeId]));
    },
    refreshGraph: () => {
      if (!graph) return;

      const communityMemberships = new Map<string, number>();
      graph.relationships.forEach(rel => {
        if (rel.type === 'MEMBER_OF') {
          const communityNode = graph.nodes.find(n => n.id === rel.targetId && n.label === 'Community');
          if (communityNode) {
            const communityIdx = parseInt(rel.targetId.replace('comm_', ''), 10) || 0;
            communityMemberships.set(rel.sourceId, communityIdx);
          }
        }
      });

      const sigmaGraph = toSigmaGraph(graph, communityMemberships);
      setSigmaGraph(sigmaGraph);
    }
  }), [setHighlightedNodeIds, graph, setSigmaGraph]);

  // Sync sigma graph whenever the project graph updates
  useEffect(() => {
    if (!graph) return;

    // Derive community index for each node from MEMBER_OF edges
    const communityMemberships = new Map<string, number>();
    graph.relationships.forEach(rel => {
      if (rel.type === 'MEMBER_OF') {
        const communityNode = graph.nodes.find(n => n.id === rel.targetId && n.label === 'Community');
        if (communityNode) {
          const communityIdx = parseInt(rel.targetId.replace('comm_', ''), 10) || 0;
          communityMemberships.set(rel.sourceId, communityIdx);
        }
      }
    });

    const sigmaGraph = toSigmaGraph(graph, communityMemberships);
    setSigmaGraph(sigmaGraph);
  }, [graph, setSigmaGraph]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    const sigmaGraph = sigma.getGraph() as Graph<NodeDisplayAttrs, EdgeDisplayAttrs>;
    if (sigmaGraph.order === 0) return;

    filterGraphByDepth(sigmaGraph, appSelectedNode?.id || null, depthFilter, visibleLabels);
    sigma.refresh();
  }, [visibleLabels, depthFilter, appSelectedNode, sigmaRef]);

  useEffect(() => {
    if (appSelectedNode) {
      setSigmaSelectedNode(appSelectedNode.id);
    } else {
      setSigmaSelectedNode(null);
    }
  }, [appSelectedNode, setSigmaSelectedNode]);

  const handleFocusSelected = useCallback(() => {
    if (appSelectedNode) {
      focusNode(appSelectedNode.id);
    }
  }, [appSelectedNode, focusNode]);

  const handleClearSelection = useCallback(() => {
    setSelectedNode(null);
    setSigmaSelectedNode(null);
    resetZoom();
  }, [setSelectedNode, setSigmaSelectedNode, resetZoom]);

  return (
    <div className="relative w-full h-full bg-void">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 40% 60%, rgba(124, 58, 237, 0.02) 0%, transparent 50%),
              radial-gradient(ellipse at 70% 30%, rgba(6, 182, 212, 0.015) 0%, transparent 50%),
              linear-gradient(to bottom, #08080c, #0c0c12)
            `
          }}
        />
      </div>

      <div
        ref={containerRef}
        className="sigma-container w-full h-full cursor-grab active:cursor-grabbing"
      />

      {hoveredNodeName && !sigmaSelectedNode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 glass-elevated rounded-lg z-20 pointer-events-none animate-fade-in">
          <span className="font-mono text-[12px] text-text-primary">{hoveredNodeName}</span>
        </div>
      )}

      {sigmaSelectedNode && appSelectedNode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 glass-elevated rounded-lg z-20 animate-fade-in">
          <div className="w-1.5 h-1.5 bg-accent rounded-full" />
          <span className="font-mono text-[12px] text-text-primary">
            {appSelectedNode.properties.name}
          </span>
          <span className="text-[11px] text-text-muted">
            {appSelectedNode.label}
          </span>
          <button
            onClick={handleClearSelection}
            className="ml-1 px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary hover:bg-white/[0.08] rounded-md transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      <div className="absolute top-4 right-4 flex items-center gap-1 z-20 glass-elevated rounded-md px-1 py-1">
        <button
          onClick={() => {
            if (isAIHighlightsEnabled) {
              setHighlightedNodeIds(new Set());
            }
            toggleAIHighlights();
          }}
          className={
            isAIHighlightsEnabled
              ? 'w-8 h-8 flex items-center justify-center bg-violet-500/15 border border-violet-400/40 rounded text-violet-200 hover:bg-violet-500/20 transition-colors'
              : 'w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors'
          }
          title={isAIHighlightsEnabled ? 'Hide highlights' : 'Show highlights'}
        >
          {isAIHighlightsEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>

        <div className="w-px h-5 bg-white/[0.1]" />

        <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors" title="Zoom In">
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors" title="Zoom Out">
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button onClick={resetZoom} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors" title="Fit to Screen">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-white/[0.1]" />

        <button
          onClick={isLayoutRunning ? stopLayout : startLayout}
          className={
            isLayoutRunning
              ? 'w-8 h-8 flex items-center justify-center bg-accent/20 rounded text-accent transition-colors'
              : 'w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors'
          }
          title={isLayoutRunning ? 'Stop Layout' : 'Run Layout Again'}
        >
          {isLayoutRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        {appSelectedNode && (
          <>
            <div className="w-px h-5 bg-white/[0.1]" />
            <button
              onClick={handleFocusSelected}
              className="w-8 h-8 flex items-center justify-center rounded text-accent hover:bg-accent/10 transition-colors"
              title="Focus on Selected Node"
            >
              <Focus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleClearSelection}
              className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:bg-white/[0.08] hover:text-text-primary transition-colors"
              title="Clear Selection"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {isLayoutRunning && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 glass-elevated rounded-md z-10 animate-fade-in">
          <span className="inline-block w-4 h-[3px] bg-violet-400/70 rounded-full animate-pulse" />
          <span className="text-[11px] text-text-secondary">Arranging nodes...</span>
        </div>
      )}

      <QueryFAB />
    </div>
  );
});

GraphCanvas.displayName = 'GraphCanvas';
