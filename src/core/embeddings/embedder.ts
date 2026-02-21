import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { DEFAULT_EMBEDDING_CONFIG, type EmbeddingConfig, type ModelProgress } from './types';

// ---- State ----

const state = {
  instance: null as FeatureExtractionPipeline | null,
  loading: false,
  pending: null as Promise<FeatureExtractionPipeline> | null,
  activeDevice: null as 'webgpu' | 'wasm' | null,
};

// ---- Types ----

export type ModelProgressCallback = (progress: ModelProgress) => void;

export class WebGPUNotAvailableError extends Error {
  constructor(originalError?: Error) {
    super('WebGPU not available in this browser');
    this.name = 'WebGPUNotAvailableError';
    this.cause = originalError;
  }
}

// ---- WebGPU Probe ----

async function probeWebGPU(): Promise<boolean> {
  try {
    const nav = navigator as any;
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return false;
    const gpuDevice = await adapter.requestDevice();
    gpuDevice.destroy();
    return true;
  } catch {
    return false;
  }
}

export const checkWebGPUAvailability = probeWebGPU;

// ---- Active Device ----

export const getCurrentDevice = (): 'webgpu' | 'wasm' | null => state.activeDevice;

// ---- Initialisation ----

function configureEnvironment(): void {
  env.allowLocalModels = false;
  env.logLevel = 'error';
  env.useBrowserCache = true;
}

function wrapProgressCallback(
  onProgress?: ModelProgressCallback
): ((data: any) => void) | undefined {
  if (!onProgress) return undefined;
  return (data: any) => {
    onProgress({
      status: data.status || 'progress',
      file: data.file,
      progress: data.progress,
      loaded: data.loaded,
      total: data.total,
    });
  };
}

async function createPipeline(
  modelId: string,
  device: 'webgpu' | 'wasm',
  progressCb?: (data: any) => void
): Promise<FeatureExtractionPipeline> {
  return await (pipeline as any)(
    'feature-extraction',
    modelId,
    {
      device,
      dtype: 'fp32',
      progress_callback: progressCb,
    }
  );
}

async function initWithWebGPU(
  modelId: string,
  progressCb?: (data: any) => void
): Promise<FeatureExtractionPipeline> {
  if (import.meta.env.DEV) {
    console.log('[prowl:embedder] checking WebGPU availability');
  }

  const gpuOk = await probeWebGPU();

  if (!gpuOk) {
    if (import.meta.env.DEV) {
      console.warn('[prowl:embedder] WebGPU not available');
    }
    state.loading = false;
    state.pending = null;
    throw new WebGPUNotAvailableError();
  }

  try {
    if (import.meta.env.DEV) {
      console.log('[prowl:embedder] initializing WebGPU backend');
    }
    const inst = await createPipeline(modelId, 'webgpu', progressCb);
    state.activeDevice = 'webgpu';
    if (import.meta.env.DEV) {
      console.log('[prowl:embedder] using WebGPU backend');
    }
    return inst;
  } catch (gpuErr) {
    if (import.meta.env.DEV) {
      console.warn('[prowl:embedder] WebGPU initialization failed:', gpuErr);
    }
    state.loading = false;
    state.pending = null;
    state.instance = null;
    throw new WebGPUNotAvailableError(gpuErr as Error);
  }
}

async function initWithWasm(
  modelId: string,
  progressCb?: (data: any) => void
): Promise<FeatureExtractionPipeline> {
  if (import.meta.env.DEV) {
    console.log('[prowl:embedder] initializing WASM backend');
  }
  const inst = await createPipeline(modelId, 'wasm', progressCb);
  state.activeDevice = 'wasm';
  if (import.meta.env.DEV) {
    console.log('[prowl:embedder] using WASM backend');
  }
  return inst;
}

export const initEmbedder = async (
  onProgress?: ModelProgressCallback,
  config: Partial<EmbeddingConfig> = {},
  forceDevice?: 'webgpu' | 'wasm'
): Promise<FeatureExtractionPipeline> => {
  if (state.instance) return state.instance;

  if (state.loading && state.pending) return state.pending;

  state.loading = true;

  const mergedConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  const targetDevice = forceDevice || mergedConfig.device;

  state.pending = (async () => {
    try {
      configureEnvironment();

      if (import.meta.env.DEV) {
        console.log(`[prowl:embedder] loading model: ${mergedConfig.modelId}`);
      }

      const wrappedCb = wrapProgressCallback(onProgress);

      if (targetDevice === 'webgpu') {
        state.instance = await initWithWebGPU(mergedConfig.modelId, wrappedCb);
      } else {
        state.instance = await initWithWasm(mergedConfig.modelId, wrappedCb);
      }

      if (import.meta.env.DEV) {
        console.log('[prowl:embedder] model loaded');
      }

      return state.instance!;
    } catch (err) {
      if (err instanceof WebGPUNotAvailableError) throw err;
      state.loading = false;
      state.pending = null;
      state.instance = null;
      throw err;
    } finally {
      state.loading = false;
    }
  })();

  return state.pending;
};

// ---- Readiness ----

export const isEmbedderReady = (): boolean => state.instance !== null;

// ---- Accessor ----

export const getEmbedder = (): FeatureExtractionPipeline => {
  if (!state.instance) {
    throw new Error('Embedding pipeline not ready. Initialize with initEmbedder() before use.');
  }
  return state.instance;
};

// ---- Embed One ----

export const embedText = async (text: string): Promise<Float32Array> => {
  const emb = getEmbedder();
  const tensor = await emb(text, { pooling: 'mean', normalize: true });
  return new Float32Array(tensor.data as ArrayLike<number>);
};

// ---- Embed Batch ----

export const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
  if (texts.length === 0) return [];

  const emb = getEmbedder();
  const tensor = await emb(texts, { pooling: 'mean', normalize: true });

  const rawData = tensor.data as ArrayLike<number>;
  const dim = DEFAULT_EMBEDDING_CONFIG.dimensions;
  const vectors: Float32Array[] = [];

  for (let i = 0; i < texts.length; i++) {
    const offset = i * dim;
    vectors.push(new Float32Array(Array.prototype.slice.call(rawData, offset, offset + dim)));
  }

  return vectors;
};

// ---- Conversion Util ----

export const embeddingToArray = (embedding: Float32Array): number[] => Array.from(embedding);

// ---- Cleanup ----

export const disposeEmbedder = async (): Promise<void> => {
  if (state.instance) {
    try {
      if ('dispose' in state.instance && typeof state.instance.dispose === 'function') {
        await state.instance.dispose();
      }
    } catch {
      // non-fatal disposal error
    }
    state.instance = null;
    state.pending = null;
  }
};
