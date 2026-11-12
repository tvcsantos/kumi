// Just enough semver for comparing Kumi's own release tags (`v0.2.0`, `v0.2.0-rc.1`).

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers: `rc.1` → ['rc', '1']. Empty for a final release. */
  pre: string[];
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const m = PATTERN.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function compareIdentifier(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  // Numeric identifiers sort before alphanumeric ones.
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return core;
  // A final release is newer than any of its pre-releases.
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const c = compareIdentifier(a.pre[i]!, b.pre[i]!);
    if (c) return c;
  }
  return a.pre.length - b.pre.length;
}

/** True when `candidate` is a newer version than `current`. Unparseable versions are never newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return !!a && !!b && compareVersions(a, b) > 0;
}
