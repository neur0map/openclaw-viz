import * as http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { shouldIgnorePath } from '../config/ignore-service';
import { FileEntry } from './zip';

// Dynamically import isomorphic-git to avoid CJS/ESM interop issues
const getGitModule = async () => {
  const m = await import('isomorphic-git');
  return m.default || m;
};

let fs: LightningFS;
let pfs: any;

function createVirtualFS(): string {
  const tag = `prowl-git-${Date.now()}`;
  fs = new LightningFS(tag);
  pfs = fs.promises;
  return tag;
}

const GH_URL_PATTERN = /github\.com\/([^\/]+)\/([^\/]+)/;

export const parseGitHubUrl = (url: string): { owner: string; repo: string } | null => {
  const normalized = url.trim().replace(/\.git$/, '');
  const hit = GH_URL_PATTERN.exec(normalized);
  if (!hit) return null;
  return { owner: hit[1], repo: hit[2] };
};

type ProgressFn = (phase: string, progress: number) => void;

async function collectFiles(root: string, cwd: string): Promise<FileEntry[]> {
  const accumulated: FileEntry[] = [];

  let dirContents: string[];
  try {
    dirContents = await pfs.readdir(cwd);
  } catch {
    console.warn(`Cannot read directory: ${cwd}`);
    return accumulated;
  }

  for (const name of dirContents) {
    if (name === '.git') continue;

    const absolute = `${cwd}/${name}`;
    const relative = absolute.replace(`${root}/`, '');

    if (shouldIgnorePath(relative)) continue;

    let info;
    try {
      info = await pfs.stat(absolute);
    } catch {
      if (import.meta.env.DEV) {
        console.warn(`Skipping unreadable entry: ${relative}`);
      }
      continue;
    }

    if (info.isDirectory()) {
      const nested = await collectFiles(root, absolute);
      for (const f of nested) accumulated.push(f);
    } else {
      try {
        const text = await pfs.readFile(absolute, { encoding: 'utf8' }) as string;
        accumulated.push({ path: relative, content: text });
      } catch {
        // binary or unreadable -- skip
      }
    }
  }

  return accumulated;
}

async function purgeDirectory(target: string): Promise<void> {
  try {
    const items = await pfs.readdir(target);
    for (const item of items) {
      const full = `${target}/${item}`;
      const meta = await pfs.stat(full);
      if (meta.isDirectory()) {
        await purgeDirectory(full);
      } else {
        await pfs.unlink(full);
      }
    }
    await pfs.rmdir(target);
  } catch {
    // cleanup errors are non-fatal
  }
}

function buildCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

function buildAuthCallback(token?: string) {
  if (!token) return undefined;
  return () => ({ username: token, password: 'x-oauth-basic' });
}

export const cloneRepository = async (
  url: string,
  onProgress?: ProgressFn,
  token?: string,
): Promise<FileEntry[]> => {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error('Invalid URL. Expected: https://github.com/owner/repo');
  }

  const dbTag = createVirtualFS();
  const workdir = `/${parsed.repo}`;
  const cloneTarget = buildCloneUrl(parsed.owner, parsed.repo);

  const report = (phase: string, pct: number) => { onProgress?.(phase, pct); };
  const cleanup = async () => {
    try { await purgeDirectory(workdir); } catch {}
    try { indexedDB.deleteDatabase(dbTag); } catch {}
  };

  try {
    report('cloning', 0);

    const git = await getGitModule();
    await git.clone({
      fs,
      http,
      dir: workdir,
      url: cloneTarget,
      depth: 1,
      onAuth: buildAuthCallback(token),
      onProgress: (ev) => {
        if (ev.total) {
          report('cloning', Math.round((ev.loaded / ev.total) * 100));
        }
      },
    });

    report('reading', 0);

    const entries = await collectFiles(workdir, workdir);

    await cleanup();
    report('complete', 100);

    return entries;
  } catch (err) {
    await cleanup();
    throw err;
  }
};
