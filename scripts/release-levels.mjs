// Important and required updates, on the release side: used by scripts/release.mjs and the
// release workflow. Plain JavaScript, so both can import it without a build.
//
// A tag marks its release with git trailers:
//
//   Kumi-Update: required                         (or important)
//   Kumi-Update-Reason: Fixes a token leak        (optional, one line)
//   Kumi-Update-Platforms: mac,windows            (optional; all platforms when left out)
//
// Every release's notes start with the requirements still in force, one hidden line each, carried
// forward from the previous release and pruned of lines a newer one covers:
//
//   <!-- kumi:required 2.0.0 Fixes a token leak in OAuth refresh -->
//   <!-- kumi:important 2.2.0 platforms=windows Fixes installs failing for Zed -->
//
// A line means: on these platforms, every version older than this one must update. So the newest
// release alone tells Kumi what applies, however many releases it skipped.
//
// Kumi reads the lines with its own parser (src/main/updater/levels.ts). The line format is the
// contract between the two; tests/release-levels.test.ts writes lines here and reads them there.

// --- Versions: just enough semver for Kumi's own tags (`v0.2.0`, `v0.2.0-rc.1`). ---

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text) {
  const m = VERSION.exec(text.trim());
  if (!m) {
    return null;
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function compareIdentifier(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) {
    return Number(a) - Number(b);
  }
  // Numeric identifiers sort before alphanumeric ones.
  if (an !== bn) {
    return an ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal. */
export function compareVersions(a, b) {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) {
    return core;
  }
  // A final release is newer than any of its pre-releases.
  if (!a.pre.length || !b.pre.length) {
    return b.pre.length - a.pre.length;
  }
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const c = compareIdentifier(a.pre[i], b.pre[i]);
    if (c) {
      return c;
    }
  }
  return a.pre.length - b.pre.length;
}

/** True when `candidate` is a newer version than `current`. Unparseable versions are never newer. */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return !!a && !!b && compareVersions(a, b) > 0;
}

/** True for `0.2.0-rc.1`, false for `0.2.0`. */
export function isPrerelease(version) {
  return !!parseVersion(version)?.pre.length;
}

// --- Trailers on the tag. ---

/** Least to most severe. */
export const LEVELS = ['important', 'required'];
export const PLATFORMS = ['mac', 'windows', 'linux'];
const MAX_REASON = 300;

/** Drops spaces from a comma-separated platform list. */
export function normalizePlatforms(platforms) {
  return platforms ? platforms.replace(/\s+/g, '') || undefined : undefined;
}

/** Why these trailer values can't mark a release, or null when they can. */
export function levelError({ level, reason, platforms }) {
  if (!level) {
    return reason || platforms ? 'a reason or platforms need a level (important or required)' : null;
  }
  if (!LEVELS.includes(level)) {
    return `the level must be important or required, not '${level}'`;
  }
  for (const p of platforms ? platforms.split(',') : []) {
    if (!PLATFORMS.includes(p)) {
      return `unknown platform '${p}' (${PLATFORMS.join(', ')})`;
    }
  }
  if (reason) {
    if (reason.includes('--')) {
      return "the reason can't contain '--': it goes in an HTML comment";
    }
    if (/[\r\n]/.test(reason)) {
      return 'the reason must be one line';
    }
    if (reason.length > MAX_REASON) {
      return `the reason is longer than the ${MAX_REASON} characters Kumi shows`;
    }
  }
  return null;
}

/** The trailer lines for a tag message. */
export function trailerLines({ level, reason, platforms }) {
  return [level && `Kumi-Update: ${level}`, reason && `Kumi-Update-Reason: ${reason}`, platforms && `Kumi-Update-Platforms: ${platforms}`].filter(Boolean);
}

/** Reads the trailers from a tag message: the `Key: value` lines of its last paragraph, like git. */
export function readTrailers(message) {
  // A signed tag carries its signature after the message.
  const text = message.split(/^-----BEGIN [A-Z ]*SIGNATURE-----$/m)[0].trim();
  const paragraphs = text.split(/\n\s*\n/);
  const found = {};
  if (paragraphs.length < 2) {
    return {};
  }
  for (const line of paragraphs.at(-1).split('\n')) {
    const m = /^([A-Za-z0-9-]+):\s*(.*?)\s*$/.exec(line);
    if (m) {
      found[m[1].toLowerCase()] = m[2];
    }
  }
  return {
    level: found['kumi-update'] || undefined,
    reason: found['kumi-update-reason'] || undefined,
    platforms: normalizePlatforms(found['kumi-update-platforms']),
  };
}

// --- Lines in the release notes. ---

const LINE = /<!--\s*kumi:(important|required)\s+(\S+)([\s\S]*?)-->/g;

/** The requirement lines in release notes. Lines with an unknown version or platform are skipped. */
export function parseLevelLines(body) {
  const entries = [];
  for (const m of (body ?? '').matchAll(LINE)) {
    const [, level, version] = m;
    if (!parseVersion(version)) {
      continue;
    }
    let rest = m[3].trim();
    let platforms;
    const p = /^platforms=(\S+)/.exec(rest);
    if (p) {
      platforms = p[1].split(',');
      if (platforms.some((x) => !PLATFORMS.includes(x))) {
        continue;
      }
      rest = rest.slice(p[0].length).trim();
    }
    entries.push({ level, version: version.replace(/^v/, ''), platforms, reason: rest ? rest.slice(0, MAX_REASON) : undefined });
  }
  return entries;
}

/** The hidden lines for release notes, most severe and newest first; '' when there are none. */
export function formatLevelLines(entries) {
  return entries
    .map((e) => `<!-- kumi:${e.level} ${e.version}${e.platforms ? ` platforms=${e.platforms.join(',')}` : ''}${e.reason ? ` ${e.reason}` : ''} -->`)
    .join('\n');
}

/** `b` makes `a` redundant: at least as severe, at least as new, on at least the same platforms. */
function covers(b, a) {
  return (
    LEVELS.indexOf(b.level) >= LEVELS.indexOf(a.level) &&
    !isNewer(a.version, b.version) &&
    (!b.platforms || (!!a.platforms && a.platforms.every((p) => b.platforms.includes(p))))
  );
}

/** The previous release's lines plus this release's own, without lines another one covers. */
export function carryLevels(previous, added = []) {
  const all = [...added, ...previous];
  const kept = all.filter((a, i) => !all.some((b, j) => j !== i && covers(b, a) && (!covers(a, b) || j < i)));
  return kept.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || compareVersions(parseVersion(b.version), parseVersion(a.version)));
}

/**
 * The release to carry lines forward from: the newest published one older than `version`.
 * A stable release only carries from stable ones, so a release candidate's requirement stays on that channel.
 */
export function previousRelease(releases, version) {
  const stable = !isPrerelease(version);
  let best = null;
  for (const r of releases) {
    if (r.draft || !isNewer(version, r.version)) {
      continue;
    }
    if (stable && isPrerelease(r.version)) {
      continue;
    }
    if (!best || isNewer(r.version, best.version)) {
      best = r;
    }
  }
  return best;
}
