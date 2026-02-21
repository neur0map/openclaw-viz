import semver from 'semver';

// Re-export both default and named exports for compatibility
export default semver.default || semver;
export const { parse, parseVersion, valid, validRange, satisfies, coerce, gt, gte, lt, lte, eq, neq, cmp, diff, major, minor, patch, prerelease, inc, rcompare, compare, compareLoose, compareBuild } = semver.default || semver;
