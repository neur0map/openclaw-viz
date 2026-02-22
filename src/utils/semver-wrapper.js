// Wrapper for semver - provides both named and default exports
let semverModule;

async function loadSemver() {
  if (!semverModule) {
    const module = await import('semver');
    semverModule = module.default || module;
  }
  return semverModule;
}

const loaded = await loadSemver();

// Re-export as both default and named exports for compatibility
export const {
  parse,
  valid,
  clean,
  SemVer,
  inc,
  diff,
  compareIdentifiers,
  rcompareIdentifiers,
  major,
  minor,
  patch,
  compare,
  compareLoose,
  compareBuild,
  rcompare,
  sort,
  rsort,
  gt,
  lt,
  eq,
  neq,
  gte,
  lte,
  cmp,
  Comparator,
  Range,
  toComparators,
  satisfies,
  minVersion,
  coerce,
} = loaded;
export default loaded;
