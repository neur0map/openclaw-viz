/**
 * Path-based framework detection for entry-point scoring.
 * Returns a scoring multiplier or null when unrecognised.
 */

export interface FrameworkHint {
  framework: string;
  entryPointMultiplier: number;
  reason: string;
}

// Path-matching rules producing a hint or null
interface PathRule {
  test: (normalized: string, filename: string) => boolean;
  hint: FrameworkHint;
}

const PATH_RULES: PathRule[] = [
  // ---------- Next.js ----------
  {
    test: (p) =>
      p.includes('/pages/') && !p.includes('/_') && !p.includes('/api/') &&
      /\.(tsx|ts|jsx|js)$/.test(p),
    hint: { framework: 'nextjs-pages', entryPointMultiplier: 3.0, reason: 'nextjs-page' },
  },
  {
    test: (p) =>
      p.includes('/app/') && /page\.(tsx|ts|jsx|js)$/.test(p),
    hint: { framework: 'nextjs-app', entryPointMultiplier: 3.0, reason: 'nextjs-app-page' },
  },
  {
    test: (p) =>
      p.includes('/pages/api/') ||
      (p.includes('/app/') && p.includes('/api/') && p.endsWith('route.ts')),
    hint: { framework: 'nextjs-api', entryPointMultiplier: 3.0, reason: 'nextjs-api-route' },
  },
  {
    test: (p) =>
      p.includes('/app/') && /layout\.(tsx|ts)$/.test(p),
    hint: { framework: 'nextjs-app', entryPointMultiplier: 2.0, reason: 'nextjs-layout' },
  },

  // ---------- Express / Node ----------
  {
    test: (p) =>
      p.includes('/routes/') && /\.(ts|js)$/.test(p),
    hint: { framework: 'express', entryPointMultiplier: 2.5, reason: 'routes-folder' },
  },

  // ---------- MVC controllers ----------
  {
    test: (p) =>
      p.includes('/controllers/') && /\.(ts|js)$/.test(p),
    hint: { framework: 'mvc', entryPointMultiplier: 2.5, reason: 'controllers-folder' },
  },

  // ---------- Generic handlers ----------
  {
    test: (p) =>
      p.includes('/handlers/') && /\.(ts|js)$/.test(p),
    hint: { framework: 'handlers', entryPointMultiplier: 2.5, reason: 'handlers-folder' },
  },

  // ---------- React components ----------
  {
    test: (p, fname) =>
      (p.includes('/components/') || p.includes('/views/')) &&
      /\.(tsx|jsx)$/.test(p) &&
      /^[A-Z]/.test(fname),
    hint: { framework: 'react', entryPointMultiplier: 1.5, reason: 'react-component' },
  },

  // ---------- Django ----------
  {
    test: (p) => p.endsWith('views.py'),
    hint: { framework: 'django', entryPointMultiplier: 3.0, reason: 'django-views' },
  },
  {
    test: (p) => p.endsWith('urls.py'),
    hint: { framework: 'django', entryPointMultiplier: 2.0, reason: 'django-urls' },
  },

  // ---------- FastAPI / Flask ----------
  {
    test: (p) =>
      (p.includes('/routers/') || p.includes('/endpoints/') || p.includes('/routes/')) &&
      p.endsWith('.py'),
    hint: { framework: 'fastapi', entryPointMultiplier: 2.5, reason: 'api-routers' },
  },
  {
    test: (p) =>
      p.includes('/api/') && p.endsWith('.py') && !p.endsWith('__init__.py'),
    hint: { framework: 'python-api', entryPointMultiplier: 2.0, reason: 'api-folder' },
  },

  // ---------- Spring Boot ----------
  {
    test: (p) =>
      (p.includes('/controller/') || p.includes('/controllers/')) && p.endsWith('.java'),
    hint: { framework: 'spring', entryPointMultiplier: 3.0, reason: 'spring-controller' },
  },
  {
    test: (p) => p.endsWith('controller.java'),
    hint: { framework: 'spring', entryPointMultiplier: 3.0, reason: 'spring-controller-file' },
  },
  {
    test: (p) =>
      (p.includes('/service/') || p.includes('/services/')) && p.endsWith('.java'),
    hint: { framework: 'java-service', entryPointMultiplier: 1.8, reason: 'java-service' },
  },

  // ---------- ASP.NET ----------
  {
    test: (p) =>
      p.includes('/controllers/') && p.endsWith('.cs'),
    hint: { framework: 'aspnet', entryPointMultiplier: 3.0, reason: 'aspnet-controller' },
  },
  {
    test: (p) => p.endsWith('controller.cs'),
    hint: { framework: 'aspnet', entryPointMultiplier: 3.0, reason: 'aspnet-controller-file' },
  },
  {
    test: (p) =>
      p.includes('/pages/') && p.endsWith('.razor'),
    hint: { framework: 'blazor', entryPointMultiplier: 2.5, reason: 'blazor-page' },
  },

  // ---------- Go ----------
  {
    test: (p) =>
      (p.includes('/handlers/') || p.includes('/handler/')) && p.endsWith('.go'),
    hint: { framework: 'go-http', entryPointMultiplier: 2.5, reason: 'go-handlers' },
  },
  {
    test: (p) =>
      p.includes('/routes/') && p.endsWith('.go'),
    hint: { framework: 'go-http', entryPointMultiplier: 2.5, reason: 'go-routes' },
  },
  {
    test: (p) =>
      p.includes('/controllers/') && p.endsWith('.go'),
    hint: { framework: 'go-mvc', entryPointMultiplier: 2.5, reason: 'go-controller' },
  },
  {
    test: (p) =>
      p.endsWith('/main.go') || (p.endsWith('/cmd/') && p.endsWith('.go')),
    hint: { framework: 'go', entryPointMultiplier: 3.0, reason: 'go-main' },
  },

  // ---------- Rust ----------
  {
    test: (p) =>
      (p.includes('/handlers/') || p.includes('/routes/')) && p.endsWith('.rs'),
    hint: { framework: 'rust-web', entryPointMultiplier: 2.5, reason: 'rust-handlers' },
  },
  {
    test: (p) => p.endsWith('/main.rs'),
    hint: { framework: 'rust', entryPointMultiplier: 3.0, reason: 'rust-main' },
  },
  {
    test: (p) =>
      p.includes('/bin/') && p.endsWith('.rs'),
    hint: { framework: 'rust', entryPointMultiplier: 2.5, reason: 'rust-bin' },
  },

  // ---------- C / C++ ----------
  {
    test: (p) =>
      p.endsWith('/main.c') || p.endsWith('/main.cpp') || p.endsWith('/main.cc'),
    hint: { framework: 'c-cpp', entryPointMultiplier: 3.0, reason: 'c-main' },
  },
  {
    test: (p) =>
      p.includes('/src/') && (p.endsWith('/app.c') || p.endsWith('/app.cpp')),
    hint: { framework: 'c-cpp', entryPointMultiplier: 2.5, reason: 'c-app' },
  },

  // ---------- Generic API index ----------
  {
    test: (p) =>
      p.includes('/api/') &&
      (p.endsWith('/index.ts') || p.endsWith('/index.js') || p.endsWith('/__init__.py')),
    hint: { framework: 'api', entryPointMultiplier: 1.8, reason: 'api-index' },
  },
];

/** Match a file path against framework rules; null if no match. */
export function detectFrameworkFromPath(filePath: string): FrameworkHint | null {
  let normalized = filePath.toLowerCase().replace(/\\/g, '/');
  if (normalized.charAt(0) !== '/') {
    normalized = '/' + normalized;
  }

  const lastSlash = normalized.lastIndexOf('/');
  const filename = lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;

  for (const rule of PATH_RULES) {
    if (rule.test(normalized, filename)) {
      return { ...rule.hint };
    }
  }

  return null;
}

/** AST-level decorator/annotation patterns (reserved for future use). */
export const FRAMEWORK_AST_PATTERNS = {
  'nestjs': ['@Controller', '@Get', '@Post', '@Put', '@Delete', '@Patch'],
  'express': ['app.get', 'app.post', 'app.put', 'app.delete', 'router.get', 'router.post'],

  'fastapi': ['@app.get', '@app.post', '@app.put', '@app.delete', '@router.get'],
  'flask': ['@app.route', '@blueprint.route'],

  'spring': ['@RestController', '@Controller', '@GetMapping', '@PostMapping', '@RequestMapping'],
  'jaxrs': ['@Path', '@GET', '@POST', '@PUT', '@DELETE'],

  'aspnet': ['[ApiController]', '[HttpGet]', '[HttpPost]', '[Route]'],

  'go-http': ['http.Handler', 'http.HandlerFunc', 'ServeHTTP'],

  'actix': ['#[get', '#[post', '#[put', '#[delete'],
  'axum': ['Router::new'],
  'rocket': ['#[get', '#[post'],
};
