interface Matcher {
  type: 'segment' | 'extension' | 'filename' | 'pattern';
  value: string | RegExp;
}

// Build artifacts
const buildArtifacts = {
  segments: [
    'dist', 'build', 'out', 'output', 'bin', 'obj', 'target',
    '.next', '.nuxt', '.output', '.vercel', '.netlify', '.serverless',
    '_build', 'public/build', '.parcel-cache', '.turbo', '.svelte-kit',
    '.generated', 'generated', 'auto-generated', '.terraform',
    'coverage', '.nyc_output', 'htmlcov', '.coverage',
    '__tests__', '__mocks__', '.jest',
    'logs', 'log', 'tmp', 'temp', 'cache', '.cache', '.tmp', '.temp',
  ],
  extensions: [
    '.exe', '.dll', '.so', '.dylib', '.a', '.lib', '.o', '.obj',
    '.class', '.jar', '.war', '.ear',
    '.pyc', '.pyo', '.pyd',
    '.beam', '.wasm', '.node',
    '.map',
    '.bin', '.dat', '.data', '.raw',
    '.iso', '.img', '.dmg',
  ],
};

// Dependencies
const dependencies = {
  segments: [
    'node_modules', 'bower_components', 'jspm_packages', 'vendor',
    'venv', '.venv', 'env', '.env',
    '__pycache__', '.pytest_cache', '.mypy_cache', 'site-packages',
    '.tox', 'eggs', '.eggs', 'lib64', 'parts', 'sdist', 'wheels',
  ],
  extensions: [
    '.lock',
  ],
  filenames: [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'composer.lock', 'Gemfile.lock', 'poetry.lock', 'Cargo.lock', 'go.sum',
  ],
};

// IDE & editor config
const ideConfig = {
  segments: [
    '.idea', '.vscode', '.vs', '.eclipse', '.settings',
    '.husky', '.github', '.circleci', '.gitlab',
    'fixtures', 'snapshots', '__snapshots__',
  ],
  extensions: [] as string[],
  filenames: [
    '.gitignore', '.gitattributes', '.npmrc', '.yarnrc',
    '.editorconfig', '.prettierrc', '.prettierignore',
    '.eslintignore', '.dockerignore',
  ],
};

// Media & binary
const mediaBinary = {
  segments: [] as string[],
  extensions: [
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff', '.tif',
    '.psd', '.ai', '.sketch', '.fig', '.xd',
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.tgz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp',
    '.mp4', '.mp3', '.wav', '.mov', '.avi', '.mkv', '.flv', '.wmv',
    '.ogg', '.webm', '.flac', '.aac', '.m4a',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
    '.csv', '.tsv', '.parquet', '.avro', '.feather',
    '.npy', '.npz', '.pkl', '.pickle', '.h5', '.hdf5',
  ],
  filenames: [
    'Thumbs.db', '.DS_Store',
  ],
};

// Security
const security = {
  segments: [] as string[],
  extensions: [
    '.pem', '.key', '.crt', '.cer', '.p12', '.pfx',
  ],
  filenames: [
    '.env', '.env.local', '.env.development', '.env.production',
    '.env.test', '.env.example',
    'SECURITY.md',
  ],
};

// Version control
const versionControl = {
  segments: [
    '.git', '.svn', '.hg', '.bzr',
  ],
  extensions: [] as string[],
  filenames: [
    'LICENSE', 'LICENSE.md', 'LICENSE.txt',
    'CHANGELOG.md', 'CHANGELOG',
    'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
  ],
};

const compoundExtensionPattern = /\.(?:min\.js|min\.css|bundle\.js|chunk\.js)$/;
const generatedPattern = /\.(?:generated\.|d\.ts$)/;
const bundledContentPattern = /\.(?:bundle\.|chunk\.|generated\.)/;

const groups = [buildArtifacts, dependencies, ideConfig, mediaBinary, security, versionControl];

const matchers: Matcher[] = [];

for (const group of groups) {
  for (const seg of group.segments) {
    matchers.push({ type: 'segment', value: seg });
  }
  for (const ext of group.extensions) {
    matchers.push({ type: 'extension', value: ext });
  }
  if ('filenames' in group) {
    for (const fname of (group as { filenames: string[] }).filenames) {
      matchers.push({ type: 'filename', value: fname });
    }
  }
}

matchers.push({ type: 'pattern', value: compoundExtensionPattern });
matchers.push({ type: 'pattern', value: generatedPattern });
matchers.push({ type: 'pattern', value: bundledContentPattern });

export const shouldIgnorePath = (filePath: string): boolean => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const fileName = parts[parts.length - 1];
  const fileNameLower = fileName.toLowerCase();

  const lastDotIndex = fileNameLower.lastIndexOf('.');
  let ext = '';
  let compoundExt = '';
  if (lastDotIndex !== -1) {
    ext = fileNameLower.substring(lastDotIndex);
    const secondLastDot = fileNameLower.lastIndexOf('.', lastDotIndex - 1);
    if (secondLastDot !== -1) {
      compoundExt = fileNameLower.substring(secondLastDot);
    }
  }

  for (const matcher of matchers) {
    switch (matcher.type) {
      case 'segment':
        for (const part of parts) {
          if (part === matcher.value) return true;
        }
        break;
      case 'extension':
        if (ext === matcher.value) return true;
        if (compoundExt === matcher.value) return true;
        break;
      case 'filename':
        if (fileName === matcher.value || fileNameLower === (matcher.value as string).toLowerCase()) return true;
        break;
      case 'pattern':
        if ((matcher.value as RegExp).test(fileNameLower)) return true;
        break;
    }
  }

  return false;
};
