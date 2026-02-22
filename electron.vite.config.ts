import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import commonjs from '@rollup/plugin-commonjs'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        },
        external: ['chokidar', 'ws', 'node-pty']
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        },
        output: {
          manualChunks: {
            'vendor-graph': ['sigma', 'graphology', 'graphology-communities-louvain', 'graphology-layout-forceatlas2', 'graphology-layout-noverlap', '@sigma/edge-curve'],
            'vendor-editor': ['@monaco-editor/react'],
            'vendor-mermaid': ['mermaid'],
            'vendor-react': ['react', 'react-dom'],
          }
        }
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      wasm(),
      topLevelAwait(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/kuzu-wasm/kuzu_wasm_worker.js',
            dest: 'assets'
          }
        ]
      }),
      commonjs({
        transformMixedEsModules: true,
        exclude: [
          /node_modules\/react/,
          /node_modules\/react-dom/,
          /node_modules\/@babel\/runtime/,
          /node_modules\/@swc\/helpers/,
          /node_modules\/@vite\/js/,
        ],
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        '@anthropic-ai/sdk/lib/transform-json-schema': resolve(__dirname, 'node_modules/@anthropic-ai/sdk/lib/transform-json-schema.mjs'),
        'mermaid': resolve(__dirname, 'node_modules/mermaid/dist/mermaid.esm.min.mjs'),
        'jszip': resolve(__dirname, 'node_modules/jszip/dist/jszip.js'),
        'events': resolve(__dirname, 'src/utils/events-wrapper.js'),
        'decamelize': resolve(__dirname, 'src/utils/decamelize-wrapper.js'),
        'camelcase': resolve(__dirname, 'src/utils/camelcase-wrapper.js'),
        'p-queue': resolve(__dirname, 'src/utils/p-queue-wrapper.js'),
        'semver': resolve(__dirname, 'src/utils/semver-wrapper.js'),
        'base64-js': resolve(__dirname, 'src/utils/base64-js-wrapper.js'),
        '@isomorphic-git/lightning-fs': resolve(__dirname, 'src/utils/lightning-fs-wrapper.js'),
        'graphology-utils/is-graph': resolve(__dirname, 'src/utils/graphology-utils-is-graph-wrapper.js'),
        'graphology-layout-forceatlas2/worker': resolve(__dirname, 'src/utils/graphology-layout-forceatlas2-worker-wrapper.js'),
        'graphology-layout-forceatlas2': resolve(__dirname, 'src/utils/graphology-layout-forceatlas2-wrapper.js'),
        'graphology-layout-noverlap': resolve(__dirname, 'src/utils/graphology-layout-noverlap-wrapper.js'),
        'style-to-js': resolve(__dirname, 'src/utils/style-to-js-wrapper.js'),
        'extend': resolve(__dirname, 'src/utils/extend-wrapper.js'),
        'graphology-communities-louvain': resolve(__dirname, 'src/utils/graphology-communities-louvain-wrapper.js'),
        'lowlight/lib/core': resolve(__dirname, 'src/utils/lowlight-lib-core-wrapper.js'),
        'lowlight': resolve(__dirname, 'src/utils/lowlight-wrapper.js'),
      },
    },
    define: {
      global: 'globalThis',
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    optimizeDeps: {
      noDiscovery: true,
      exclude: ['kuzu-wasm'],
      include: [
        'buffer',
        'comlink',
        'events',
        'jszip',
        'lru-cache',
        'minisearch',
        'msgpackr',
        'web-tree-sitter',
        'zod',

        'graphology',
        'graphology-communities-louvain',
        'graphology-layout-forceatlas2',
        'graphology-layout-forceatlas2/worker',
        'graphology-layout-noverlap',
        'graphology-utils/defaults',
        'graphology-utils/is-graph',
        'graphology-utils/infer-type',
        'graphology-indices/louvain',
        'mnemonist/sparse-map',
        'mnemonist/sparse-queue-set',
        'pandemonium/random-index',
        'pandemonium/random',

        'sigma',
        '@sigma/edge-curve',

        '@langchain/core/messages',
        '@langchain/core/language_models/chat_models',
        '@langchain/core/tools',
        '@langchain/anthropic',
        '@langchain/openai',
        '@langchain/google-genai',
        '@langchain/ollama',
        '@langchain/langgraph/prebuilt',

        '@huggingface/transformers',

        'isomorphic-git',
        'isomorphic-git/http/web',
        '@isomorphic-git/lightning-fs',

        'react',
        'react-dom/client',
        'react-markdown',
        'react-syntax-highlighter',
        'react-syntax-highlighter/dist/esm/styles/prism',
        'remark-gfm',
        'lucide-react',

        '@monaco-editor/react',
        'monaco-editor',

        '@xterm/xterm',
        '@xterm/addon-fit',
        '@xterm/addon-webgl',
      ],
    },
    worker: {
      format: 'es' as const,
      plugins: () => [
        commonjs({
          transformMixedEsModules: true,
        }),
        wasm(),
        topLevelAwait(),
      ],
    },
  }
})
