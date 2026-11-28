// Just enough semver to read the runtime ranges in a bundle's `compatibility.runtimes`, e.g. ">=v20.18.1",
// ">=3.8,<4.0", "^1.2.3", ">1.0.0 <2.0.0", "18 || 20". Prerelease tags are ignored.

type Version = [number, number, number];

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** "v22.11.0" → [22, 11, 0]; "Python 3.12.1" → [3, 12, 1]; null when there's no version in it. */
export function parseVersion(text: string): Version | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

type Test = (v: Version) => boolean;

/** One comparator as a test, or null when Kumi can't read it. */
function comparator(text: string): Test | null {
  if (text === '*' || text === 'x' || text === '') return () => true;
  const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+][\w.-]*)?$/.exec(text);
  if (!m) return null;
  const [, op = '', major, minorText, patchText] = m;
  const wild = (p: string | undefined) => p === undefined || p === 'x' || p === '*';
  const given = wild(minorText) ? 1 : wild(patchText) ? 2 : 3;
  const v: Version = [Number(major), given > 1 ? Number(minorText) : 0, given > 2 ? Number(patchText) : 0];
  const bump = (at: number): Version => (at === 0 ? [v[0] + 1, 0, 0] : at === 1 ? [v[0], v[1] + 1, 0] : [v[0], v[1], v[2] + 1]);
  const between = (lo: Version, hi: Version): Test => (x) => compare(x, lo) >= 0 && compare(x, hi) < 0;
  switch (op) {
    case '>=':
      return (x) => compare(x, v) >= 0;
    case '>':
      return given === 3 ? (x) => compare(x, v) > 0 : (x) => compare(x, bump(given - 1)) >= 0;
    case '<=':
      return given === 3 ? (x) => compare(x, v) <= 0 : (x) => compare(x, bump(given - 1)) < 0;
    case '<':
      return (x) => compare(x, v) < 0;
    case '^': {
      const at = v[0] > 0 || given === 1 ? 0 : v[1] > 0 || given === 2 ? 1 : 2;
      return between(v, bump(at));
    }
    case '~':
      return between(v, bump(given === 1 ? 0 : 1));
    default:
      return given === 3 ? (x) => compare(x, v) === 0 : between(v, bump(given - 1));
  }
}

/**
 * Whether `version` is in `range`. Undefined when either can't be read, so callers say nothing rather than guess.
 */
export function satisfies(version: string, range: string): boolean | undefined {
  const v = parseVersion(version);
  if (!v) return undefined;
  const alternatives = range.split('||').map((alt) =>
    alt
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(comparator),
  );
  if (alternatives.some((alt) => alt.some((t) => t === null))) return undefined;
  return alternatives.some((alt) => (alt as Test[]).every((t) => t(v)));
}
