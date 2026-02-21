import { useRef, useEffect, useCallback, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import EdgeCurveProgram from '@sigma/edge-curve';
import { NodeDisplayAttrs, EdgeDisplayAttrs } from '../lib/graph-adapter';
import type { NodeAnimation } from './useAppState';
import type { EdgeType } from '../lib/constants';

const DARK_BG_R = 18;
const DARK_BG_G = 18;
const DARK_BG_B = 28;

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [100, 100, 100];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  const parts = [r, g, b].map((v) => {
    const h = clampByte(v).toString(16);
    return h.length < 2 ? '0' + h : h;
  });
  return '#' + parts.join('');
}

function dimColor(hex: string, strength: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    DARK_BG_R + (r - DARK_BG_R) * strength,
    DARK_BG_G + (g - DARK_BG_G) * strength,
    DARK_BG_B + (b - DARK_BG_B) * strength,
  );
}

function brightenColor(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  const lift = (ch: number) => ch + ((255 - ch) * (factor - 1)) / factor;
  return toHex(lift(r), lift(g), lift(b));
}

interface UseSigmaOptions {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
  highlightedNodeIds?: Set<string>;
  blastRadiusNodeIds?: Set<string>;
  animatedNodes?: Map<string, NodeAnimation>;
  visibleEdgeTypes?: EdgeType[];
}

interface UseSigmaReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  sigmaRef: React.RefObject<Sigma | null>;
  setGraph: (graph: Graph<NodeDisplayAttrs, EdgeDisplayAttrs>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  focusNode: (nodeId: string) => void;
  isLayoutRunning: boolean;
  startLayout: () => void;
  stopLayout: () => void;
  selectedNode: string | null;
  setSelectedNode: (nodeId: string | null) => void;
  refreshHighlights: () => void;
}

const OVERLAP_CLEANUP = {
  maxIterations: 150,
  ratio: 2,
  margin: 25,
  expansion: 1.3,
};

const FA2_TIERS = [
  { ceiling: 500,   gravity: 0.02,  scaling: 150, slow: 8,  bhTheta: 0.5 },
  { ceiling: 2000,  gravity: 0.015, scaling: 200, slow: 10, bhTheta: 0.5 },
  { ceiling: 10000, gravity: 0.01,  scaling: 300, slow: 12, bhTheta: 0.8 },
  { ceiling: Infinity, gravity: 0.005, scaling: 400, slow: 15, bhTheta: 0.8 },
];

function pickFA2Settings(nodeCount: number) {
  const tier = FA2_TIERS.find((t) => nodeCount < t.ceiling)!;
  return {
    gravity: tier.gravity,
    scalingRatio: tier.scaling,
    slowDown: tier.slow,
    barnesHutOptimize: nodeCount > 100,
    barnesHutTheta: tier.bhTheta,
    strongGravityMode: false,
    outboundAttractionDistribution: true,
    linLogMode: false,
    adjustSizes: true,
    edgeWeightInfluence: 1,
  };
}

const DURATION_BRACKETS: [number, number][] = [
  [10000, 30000],
  [5000, 25000],
  [2000, 20000],
  [1000, 15000],
  [500, 12000],
];

function computeLayoutDuration(nodeCount: number): number {
  for (const [threshold, dur] of DURATION_BRACKETS) {
    if (nodeCount > threshold) return dur;
  }
  return 10000;
}

const SIGMA_INIT = {
  renderLabels: true,
  labelFont: 'JetBrains Mono, monospace',
  labelSize: 11,
  labelWeight: '500' as const,
  labelColor: { color: '#e4e4ed' },
  labelRenderedSizeThreshold: 8,
  labelDensity: 0.1,
  labelGridCellSize: 70,
  defaultNodeColor: '#6b7280',
  defaultEdgeColor: '#2a2a3a',
  defaultEdgeType: 'curved' as const,
  minCameraRatio: 0.002,
  maxCameraRatio: 50,
  hideEdgesOnMove: true,
  zIndex: true,
};

function renderHoverTooltip(
  ctx: CanvasRenderingContext2D,
  data: any,
  settings: any,
) {
  const text = data.label;
  if (!text) return;

  const fontSize = settings.labelSize || 11;
  const fontFace = settings.labelFont || 'JetBrains Mono, monospace';
  const fontWeight = settings.labelWeight || '500';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFace}`;

  const measured = ctx.measureText(text).width;
  const nodeRad = data.size || 8;
  const cx = data.x;
  const cy = data.y - nodeRad - 10;
  const padH = 8;
  const padV = 5;
  const boxW = measured + padH * 2;
  const boxH = fontSize + padV * 2;
  const corner = 4;

  ctx.fillStyle = '#12121c';
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, corner);
  ctx.fill();

  ctx.strokeStyle = data.color || '#6366f1';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#f5f5f7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);

  ctx.beginPath();
  ctx.arc(data.x, data.y, nodeRad + 4, 0, Math.PI * 2);
  ctx.strokeStyle = data.color || '#6366f1';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

type AnimKind = NodeAnimation['type'];

const ANIM_CONFIG: Record<AnimKind, {
  cycles: number;
  baseScale: number;
  amplitude: number;
  colA: string;
  colB: string | null;
  zIdx: number;
}> = {
  pulse:   { cycles: 4, baseScale: 1.5, amplitude: 0.8, colA: '#06b6d4', colB: null,    zIdx: 5 },
  ripple:  { cycles: 4, baseScale: 1.3, amplitude: 1.2, colA: '#ef4444', colB: '#f87171', zIdx: 5 },
  glow:    { cycles: 4, baseScale: 1.4, amplitude: 0.6, colA: '#a855f7', colB: '#c084fc', zIdx: 5 },
  watcher: { cycles: 2, baseScale: 1.6, amplitude: 1.0, colA: '#30D158', colB: null,    zIdx: 6 },
};

function applyAnimation(
  res: Record<string, any>,
  baseSize: number,
  anim: NodeAnimation,
): void {
  const elapsed = Date.now() - anim.startTime;
  const t = Math.min(elapsed / anim.duration, 1);
  const cfg = ANIM_CONFIG[anim.type];
  const wave = (Math.sin(t * Math.PI * cfg.cycles) + 1) / 2;

  res.size = baseSize * (cfg.baseScale + wave * cfg.amplitude);
  res.zIndex = cfg.zIdx;
  res.highlighted = true;

  if (anim.type === 'watcher') {
    res.color = brightenColor(cfg.colA, 1 + wave * 0.6);
  } else if (cfg.colB) {
    res.color = wave > 0.5 ? cfg.colA : cfg.colB;
  } else {
    res.color = wave > 0.5 ? cfg.colA : brightenColor(cfg.colA, 1.3);
  }
}

export const useSigma = (options: UseSigmaOptions = {}): UseSigmaReturn => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph<NodeDisplayAttrs, EdgeDisplayAttrs> | null>(null);
  const fa2Ref = useRef<FA2Layout | null>(null);
  const pickedNodeRef = useRef<string | null>(null);
  const hlRef = useRef<Set<string>>(new Set());
  const brRef = useRef<Set<string>>(new Set());
  const animRef = useRef<Map<string, NodeAnimation>>(new Map());
  const edgeFilterRef = useRef<EdgeType[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const [layoutActive, setLayoutActive] = useState(false);
  const [pickedNode, setPickedNodeState] = useState<string | null>(null);

  useEffect(() => {
    hlRef.current = options.highlightedNodeIds || new Set();
    brRef.current = options.blastRadiusNodeIds || new Set();
    animRef.current = options.animatedNodes || new Map();
    edgeFilterRef.current = options.visibleEdgeTypes || null;
    sigmaRef.current?.refresh();
  }, [options.highlightedNodeIds, options.blastRadiusNodeIds, options.animatedNodes, options.visibleEdgeTypes]);

  useEffect(() => {
    const anims = options.animatedNodes;
    if (!anims || anims.size === 0) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      sigmaRef.current?.refresh();
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [options.animatedNodes]);

  const setSelectedNode = useCallback((nodeId: string | null) => {
    pickedNodeRef.current = nodeId;
    setPickedNodeState(nodeId);

    const inst = sigmaRef.current;
    if (!inst) return;

    const cam = inst.getCamera();
    cam.animate({ ratio: cam.ratio * 1.0001 }, { duration: 50 });
    inst.refresh();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph<NodeDisplayAttrs, EdgeDisplayAttrs>();
    graphRef.current = graph;

    const renderer = new Sigma(graph, containerRef.current, {
      ...SIGMA_INIT,
      edgeProgramClasses: { curved: EdgeCurveProgram },
      defaultDrawNodeHover: renderHoverTooltip,

      nodeReducer: (nid, data) => {
        const out = { ...data };
        if (data.hidden) { out.hidden = true; return out; }

        const sel = pickedNodeRef.current;
        const hlSet = hlRef.current;
        const brSet = brRef.current;
        const animMap = animRef.current;
        const anyHL = hlSet.size > 0;
        const anyBR = brSet.size > 0;
        const inHL = hlSet.has(nid);
        const inBR = brSet.has(nid);
        const sz = data.size || 8;

        const nodeAnim = animMap.get(nid);
        if (nodeAnim) {
          applyAnimation(out, sz, nodeAnim);
          return out;
        }

        if (anyBR && !sel) {
          if (inBR) {
            out.color = '#ef4444';
            out.size = sz * 1.8;
            out.zIndex = 3;
            out.highlighted = true;
          } else if (inHL) {
            out.color = '#06b6d4';
            out.size = sz * 1.4;
            out.zIndex = 2;
            out.highlighted = true;
          } else {
            out.color = dimColor(data.color, 0.15);
            out.size = sz * 0.4;
            out.zIndex = 0;
          }
          return out;
        }

        if (anyHL && !sel) {
          if (inHL) {
            out.color = '#06b6d4';
            out.size = sz * 1.6;
            out.zIndex = 2;
            out.highlighted = true;
          } else {
            out.color = dimColor(data.color, 0.2);
            out.size = sz * 0.5;
            out.zIndex = 0;
          }
          return out;
        }

        if (sel) {
          const g = graphRef.current;
          if (g) {
            const isSelf = nid === sel;
            const adjacent = g.hasEdge(nid, sel) || g.hasEdge(sel, nid);
            if (isSelf) {
              out.color = data.color;
              out.size = sz * 1.8;
              out.zIndex = 2;
              out.highlighted = true;
            } else if (adjacent) {
              out.color = data.color;
              out.size = sz * 1.3;
              out.zIndex = 1;
            } else {
              out.color = dimColor(data.color, 0.25);
              out.size = sz * 0.6;
              out.zIndex = 0;
            }
          }
        }

        return out;
      },

      edgeReducer: (eid, data) => {
        const out = { ...data };

        const allowed = edgeFilterRef.current;
        if (allowed && data.relationType) {
          if (!allowed.includes(data.relationType as EdgeType)) {
            out.hidden = true;
            return out;
          }
        }

        const sel = pickedNodeRef.current;
        const hlSet = hlRef.current;
        const brSet = brRef.current;
        const anyActive = hlSet.size > 0 || brSet.size > 0;

        if (anyActive && !sel) {
          const g = graphRef.current;
          if (g) {
            const [src, tgt] = g.extremities(eid);
            const srcOn = hlSet.has(src) || brSet.has(src);
            const tgtOn = hlSet.has(tgt) || brSet.has(tgt);

            if (srcOn && tgtOn) {
              const bothBlast = brSet.has(src) && brSet.has(tgt);
              out.color = bothBlast ? '#ef4444' : '#06b6d4';
              out.size = Math.max(2, (data.size || 1) * 3);
              out.zIndex = 2;
            } else if (srcOn || tgtOn) {
              out.color = dimColor('#06b6d4', 0.4);
              out.size = 1;
              out.zIndex = 1;
            } else {
              out.color = dimColor(data.color, 0.08);
              out.size = 0.2;
              out.zIndex = 0;
            }
          }
          return out;
        }

        if (sel) {
          const g = graphRef.current;
          if (g) {
            const [src, tgt] = g.extremities(eid);
            const linked = src === sel || tgt === sel;
            if (linked) {
              out.color = brightenColor(data.color, 1.5);
              out.size = Math.max(3, (data.size || 1) * 4);
              out.zIndex = 2;
            } else {
              out.color = dimColor(data.color, 0.1);
              out.size = 0.3;
              out.zIndex = 0;
            }
          }
        }

        return out;
      },
    });

    sigmaRef.current = renderer;

    renderer.on('clickNode', ({ node }) => {
      setSelectedNode(node);
      options.onNodeClick?.(node);
    });
    renderer.on('clickStage', () => {
      setSelectedNode(null);
      options.onStageClick?.();
    });
    renderer.on('enterNode', ({ node }) => {
      options.onNodeHover?.(node);
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    renderer.on('leaveNode', () => {
      options.onNodeHover?.(null);
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      fa2Ref.current?.kill();
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  const executeLayout = useCallback((graph: Graph<NodeDisplayAttrs, EdgeDisplayAttrs>) => {
    const n = graph.order;
    if (n === 0) return;

    if (fa2Ref.current) {
      fa2Ref.current.kill();
      fa2Ref.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const inferred = forceAtlas2.inferSettings(graph);
    const merged = { ...inferred, ...pickFA2Settings(n) };
    const worker = new FA2Layout(graph, { settings: merged });
    fa2Ref.current = worker;
    worker.start();
    setLayoutActive(true);

    timerRef.current = setTimeout(() => {
      if (fa2Ref.current) {
        fa2Ref.current.stop();
        fa2Ref.current = null;
        noverlap.assign(graph, OVERLAP_CLEANUP);
        sigmaRef.current?.refresh();
        setLayoutActive(false);
      }
    }, computeLayoutDuration(n));
  }, []);

  const setGraph = useCallback((incoming: Graph<NodeDisplayAttrs, EdgeDisplayAttrs>) => {
    const inst = sigmaRef.current;
    if (!inst) return;

    if (fa2Ref.current) { fa2Ref.current.kill(); fa2Ref.current = null; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    graphRef.current = incoming;
    inst.setGraph(incoming);
    setSelectedNode(null);

    executeLayout(incoming);
    inst.getCamera().animatedReset({ duration: 500 });
  }, [executeLayout, setSelectedNode]);

  const focusNode = useCallback((nodeId: string) => {
    const inst = sigmaRef.current;
    const g = graphRef.current;
    if (!inst || !g || !g.hasNode(nodeId)) return;

    const wasAlreadyPicked = pickedNodeRef.current === nodeId;
    pickedNodeRef.current = nodeId;
    setPickedNodeState(nodeId);

    if (!wasAlreadyPicked) {
      const attrs = g.getNodeAttributes(nodeId);
      inst.getCamera().animate(
        { x: attrs.x, y: attrs.y, ratio: 0.15 },
        { duration: 400 },
      );
    }
    inst.refresh();
  }, []);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
    setSelectedNode(null);
  }, [setSelectedNode]);

  const startLayout = useCallback(() => {
    const g = graphRef.current;
    if (!g || g.order === 0) return;
    executeLayout(g);
  }, [executeLayout]);

  const stopLayout = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (fa2Ref.current) {
      fa2Ref.current.stop();
      fa2Ref.current = null;
      const g = graphRef.current;
      if (g) {
        noverlap.assign(g, OVERLAP_CLEANUP);
        sigmaRef.current?.refresh();
      }
      setLayoutActive(false);
    }
  }, []);

  const refreshHighlights = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return {
    containerRef,
    sigmaRef,
    setGraph,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    isLayoutRunning: layoutActive,
    startLayout,
    stopLayout,
    selectedNode: pickedNode,
    setSelectedNode,
    refreshHighlights,
  };
};
