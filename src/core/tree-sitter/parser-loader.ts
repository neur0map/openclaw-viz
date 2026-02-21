import { SupportedLanguages } from '../../config/supported-languages';

// Dynamic import to handle web-tree-sitter's UMD/CommonJS export pattern
const loadTreeSitter = async () => {
    const module = await import('web-tree-sitter');
    return module.default || module;
};

type Parser = any;
type Language = any;

let parser: Parser | null = null;

// Compiled Language cache to avoid redundant fetches
const languageCache = new Map<string, Language>();

/**
 * Resolve WASM paths for dev (Vite) and production (Electron file://) builds.
 * Uses string manipulation because Vite mis-transforms dynamic URL patterns.
 */
function resolveWasmUrl(subPath: string): string {
    const moduleUrl = import.meta.url;
    if (moduleUrl.startsWith('file:')) {
        // moduleUrl = file:///path/dist/renderer/assets/chunk-xxx.js
        const moduleDir = moduleUrl.substring(0, moduleUrl.lastIndexOf('/'));
        // moduleDir = file:///path/dist/renderer/assets
        const rendererDir = moduleDir.substring(0, moduleDir.lastIndexOf('/'));
        // rendererDir = file:///path/dist/renderer
        return `${rendererDir}/wasm/${subPath}`;
    }
    return `/wasm/${subPath}`;
}

export const loadParser = async (): Promise<Parser> => {
    if (parser) return parser;

    const Parser = await loadTreeSitter();

    await Parser.init({
        locateFile: (scriptName: string) => {
            return resolveWasmUrl(scriptName);
        }
    })

    parser = new Parser();
    return parser;
}

// Map language + file extension to WASM grammar path
const getWasmPath = (language: SupportedLanguages, filePath?: string): string => {
    // TSX needs a separate grammar
    if (language === SupportedLanguages.TypeScript) {
        if (filePath?.endsWith('.tsx')) {
            return resolveWasmUrl('typescript/tree-sitter-tsx.wasm');
        }
        return resolveWasmUrl('typescript/tree-sitter-typescript.wasm');
    }

    const languageFileMap: Record<SupportedLanguages, string> = {
        [SupportedLanguages.JavaScript]: 'javascript/tree-sitter-javascript.wasm',
        [SupportedLanguages.TypeScript]: 'typescript/tree-sitter-typescript.wasm',
        [SupportedLanguages.Python]: 'python/tree-sitter-python.wasm',
        [SupportedLanguages.Java]: 'java/tree-sitter-java.wasm',
        [SupportedLanguages.C]: 'c/tree-sitter-c.wasm',
        [SupportedLanguages.CPlusPlus]: 'cpp/tree-sitter-cpp.wasm',
        [SupportedLanguages.CSharp]: 'csharp/tree-sitter-csharp.wasm',
        [SupportedLanguages.Go]: 'go/tree-sitter-go.wasm',
        [SupportedLanguages.Rust]: 'rust/tree-sitter-rust.wasm',
    };

    return resolveWasmUrl(languageFileMap[language]);
};

/** Load WASM via XHR (needed for Electron file:// where fetch() fails). */
function loadWasmBytes(url: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                resolve(new Uint8Array(xhr.response));
            } else {
                reject(new Error(`Failed to load WASM: ${url} (status ${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error(`XHR error loading WASM: ${url}`));
        xhr.send(null);
    });
}

export const loadLanguage = async (language: SupportedLanguages, filePath?: string): Promise<void> => {
    if (!parser) await loadParser();
    const wasmPath = getWasmPath(language, filePath);

    if (languageCache.has(wasmPath)) {
        parser!.setLanguage(languageCache.get(wasmPath)!);
        return;
    }

    if (!wasmPath) {
        console.error(`[prowl:parser] no WASM path configured for language: ${language}`);
        throw new Error(`Unsupported language: ${language}`);
    }

    try {
        // Pre-load via XHR for file:// compatibility in Electron
        const wasmInput: string | Uint8Array = wasmPath.startsWith('file:')
            ? await loadWasmBytes(wasmPath)
            : wasmPath;
        const Parser = await loadTreeSitter();
        const loadedLanguage = await Parser.Language.load(wasmInput);
        languageCache.set(wasmPath, loadedLanguage);
        parser!.setLanguage(loadedLanguage);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[prowl:parser] failed to load WASM grammar for ${language}`);
        console.error(`   WASM Path: ${wasmPath}`);
        console.error(`   Error: ${errorMessage}`);
        throw new Error(`Failed to load grammar for ${language}: ${errorMessage}`);
    }
}
