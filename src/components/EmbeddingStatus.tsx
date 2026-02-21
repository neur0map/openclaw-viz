import { Brain, Loader2, Check, AlertCircle, Zap, FlaskConical } from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { useState, type ReactNode } from 'react';
import { WebGPUFallbackDialog } from './WebGPUFallbackDialog';

function ProgressBar({ percent, colorClass }: { percent: number; colorClass: string }) {
  return (
    <div className="w-24 h-1 bg-elevated rounded-full overflow-hidden">
      <div
        className={`h-full ${colorClass} rounded-full transition-all duration-300`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatusPill({
  children,
  borderColor,
  bgColor,
}: {
  children: ReactNode;
  borderColor: string;
  bgColor?: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${bgColor ?? 'bg-surface'} border ${borderColor} rounded-lg text-sm`}>
      {children}
    </div>
  );
}

function renderIdleState(
  onStart: () => void,
  onTest: () => void,
  diagResult: string | null,
) {
  return (
    <div className="flex items-center gap-2">
      {import.meta.env.DEV && (
        <button
          onClick={onTest}
          className="flex items-center gap-1 px-2 py-1.5 bg-surface border border-border-subtle rounded-lg text-xs text-text-muted hover:bg-hover hover:text-text-secondary transition-all"
          title="Run KuzuDB array parameter diagnostic"
        >
          <FlaskConical className="w-3 h-3" />
          {diagResult || 'Test'}
        </button>
      )}
      <button
        onClick={onStart}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border-subtle rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary hover:border-accent/50 transition-all group"
        title="Build vector index for search"
      >
        <Brain className="w-4 h-4 text-node-interface group-hover:text-accent transition-colors" />
        <span className="hidden sm:inline">Enable Semantic Search</span>
        <Zap className="w-3 h-3 text-text-muted" />
      </button>
    </div>
  );
}

function renderLoadingState(downloadPct: number) {
  return (
    <StatusPill borderColor="border-accent/30">
      <Loader2 className="w-4 h-4 text-accent animate-spin" />
      <div className="flex flex-col gap-0.5">
        <span className="text-text-secondary text-xs">Loading AI model...</span>
        <ProgressBar percent={downloadPct} colorClass="bg-accent" />
      </div>
    </StatusPill>
  );
}

function renderEmbeddingState(done: number, total: number, pct: number) {
  return (
    <StatusPill borderColor="border-node-function/30">
      <Loader2 className="w-4 h-4 text-node-function animate-spin" />
      <div className="flex flex-col gap-0.5">
        <span className="text-text-secondary text-xs">
          Embedding {done}/{total} nodes
        </span>
        <ProgressBar percent={pct} colorClass="bg-node-function" />
      </div>
    </StatusPill>
  );
}

function renderIndexingState() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-node-interface/30 rounded-lg text-sm text-text-secondary">
      <Loader2 className="w-4 h-4 text-node-interface animate-spin" />
      <span className="text-xs">Creating vector index...</span>
    </div>
  );
}

function renderReadyState() {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 border border-violet-500/30 rounded-md text-sm text-violet-300"
      title="Vector index built. Use natural language in the AI chat."
    >
      <Check className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">Vectors Active</span>
    </div>
  );
}

function renderErrorState(onRetry: () => void, errMsg?: string) {
  return (
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 hover:bg-red-500/20 transition-colors"
      title={errMsg || 'Indexing failed. Click to retry.'}
    >
      <AlertCircle className="w-4 h-4" />
      <span className="text-xs">Failed - Retry</span>
    </button>
  );
}

export const EmbeddingStatus = () => {
  const {
    embeddingStatus,
    embeddingProgress,
    startEmbeddings,
    graph,
    viewMode,
    testArrayParams,
  } = useAppState();

  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [fallbackVisible, setFallbackVisible] = useState(false);

  if (viewMode !== 'exploring' || !graph) return null;

  const totalNodes = graph.nodes.length;

  const triggerEmbeddings = async (device?: 'webgpu' | 'wasm') => {
    try {
      await startEmbeddings(device);
    } catch (err: any) {
      if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU not available')) {
        setFallbackVisible(true);
      } else {
        console.error('Embedding failed:', err);
      }
    }
  };

  const onFallbackCPU = () => {
    setFallbackVisible(false);
    triggerEmbeddings('wasm');
  };

  const onFallbackSkip = () => { setFallbackVisible(false); };

  const runDiagnostic = async () => {
    setDiagResult('Testing...');
    const result = await testArrayParams();
    if (result.success) {
      setDiagResult('Array params OK');
    } else {
      setDiagResult(`Failed: ${result.error}`);
      console.error('[prowl:embedding] array params test failed:', result.error);
    }
  };

  const dialog = (
    <WebGPUFallbackDialog
      isOpen={fallbackVisible}
      onClose={() => setFallbackVisible(false)}
      onUseCPU={onFallbackCPU}
      onSkip={onFallbackSkip}
      nodeCount={totalNodes}
    />
  );

  const statusRenderers: Record<string, () => ReactNode> = {
    idle: () => renderIdleState(() => triggerEmbeddings(), runDiagnostic, diagResult),
    loading: () => renderLoadingState(embeddingProgress?.modelDownloadPercent ?? 0),
    embedding: () => renderEmbeddingState(
      embeddingProgress?.nodesProcessed ?? 0,
      embeddingProgress?.totalNodes ?? 0,
      embeddingProgress?.percent ?? 0,
    ),
    indexing: renderIndexingState,
    ready: renderReadyState,
    error: () => renderErrorState(() => triggerEmbeddings(), embeddingProgress?.error),
  };

  const renderer = statusRenderers[embeddingStatus];
  if (!renderer) return null;

  const content = renderer();
  const needsDialog = embeddingStatus === 'idle' || embeddingStatus === 'loading' || embeddingStatus === 'error';

  if (needsDialog) {
    return <>{content}{dialog}</>;
  }

  return <>{content}</>;
};
