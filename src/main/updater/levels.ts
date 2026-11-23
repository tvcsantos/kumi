// Important and required updates, as Kumi applies them. The release workflow writes one hidden
// line per requirement still in force at the top of every release's notes:
//
//   <!-- kumi:required 2.0.0 Fixes a token leak in OAuth refresh -->
//   <!-- kumi:important 2.2.0 platforms=windows Fixes installs failing for Zed -->
//
// A line means: on these platforms, every version older than this one must update. The workflow
// carries the lines forward (scripts/release-levels.mjs), so the newest release alone tells Kumi
// what applies. That module writes the lines and this one reads them; tests/release-levels.test.ts
// checks the two agree. Kumi remembers the lines it sees, so going offline doesn't lift them.

import type { UpdateChannel, UpdateLevel, UpdateUrgency } from '@shared/api';
import { compareVersions, isNewer, parseVersion } from './version';

export type ReleasePlatform = 'mac' | 'windows' | 'linux';

const PLATFORMS: readonly ReleasePlatform[] = ['mac', 'windows', 'linux'];
/** Longer reasons are cut; the release script refuses them anyway. */
const MAX_REASON = 300;

export function releasePlatform(platform: NodeJS.Platform): ReleasePlatform {
  return platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';
}

/** One hidden line in the release notes. */
export interface LevelLine {
  level: UpdateLevel;
  /** Every older version must update. */
  version: string;
  /** Every platform when absent. */
  platforms?: ReleasePlatform[];
  reason?: string;
}

const LINE = /<!--\s*kumi:(important|required)\s+(\S+)([\s\S]*?)-->/g;

const isPlatform = (p: string): p is ReleasePlatform => (PLATFORMS as readonly string[]).includes(p);

/** The requirement lines in release notes. Lines with an unknown version or platform are skipped, not guessed at. */
export function parseLevelLines(body: string | null | undefined): LevelLine[] {
  const lines: LevelLine[] = [];
  for (const m of (body ?? '').matchAll(LINE)) {
    const level = m[1] as UpdateLevel;
    const version = m[2]!;
    if (!parseVersion(version)) continue;
    let rest = m[3]!.trim();
    let platforms: ReleasePlatform[] | undefined;
    const p = /^platforms=(\S+)/.exec(rest);
    if (p) {
      const names = p[1]!.split(',');
      if (!names.every(isPlatform)) continue;
      platforms = names;
      rest = rest.slice(p[0].length).trim();
    }
    lines.push({ level, version: version.replace(/^v/, ''), platforms, reason: rest ? rest.slice(0, MAX_REASON) : undefined });
  }
  return lines;
}

const isPrerelease = (version: string) => !!parseVersion(version)?.pre.length;

/** A requirement, as Kumi remembers it. */
export interface UpdateMarker extends UpdateUrgency {
  /** Names a pre-release, so it only applies on the prerelease channel. */
  prerelease: boolean;
}

const SEVERITY: readonly UpdateLevel[] = ['required', 'important'];

/** The requirements in release notes that apply on this platform. `urlOf` finds the release page of the version a line names. */
export function markersIn(body: string | null | undefined, platform: ReleasePlatform, urlOf: (version: string) => string): UpdateMarker[] {
  return parseLevelLines(body)
    .filter((line) => !line.platforms || line.platforms.includes(platform))
    .map((line) => ({ level: line.level, version: line.version, reason: line.reason, url: urlOf(line.version), prerelease: isPrerelease(line.version) }));
}

/** Adds newly seen markers to the remembered ones. Keeps the newest per level and channel, and drops what this version already satisfies. */
export function mergeMarkers(saved: UpdateMarker[], found: UpdateMarker[], currentVersion: string): UpdateMarker[] {
  const best = new Map<string, UpdateMarker>();
  for (const m of [...saved, ...found]) {
    if (!isNewer(m.version, currentVersion)) continue;
    const key = `${m.level}|${m.prerelease}`;
    const had = best.get(key);
    if (!had || isNewer(m.version, had.version)) best.set(key, m);
  }
  return [...best.values()].sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!));
}

/** How urgently this version must update: the most severe level that applies, from its newest line. */
export function urgencyOf(markers: UpdateMarker[], currentVersion: string, channel: UpdateChannel): UpdateUrgency | undefined {
  for (const level of SEVERITY) {
    const applies = markers.filter((m) => m.level === level && isNewer(m.version, currentVersion) && (channel === 'prerelease' || !m.prerelease));
    const newest = applies.reduce<UpdateMarker | undefined>((a, m) => (!a || isNewer(m.version, a.version) ? m : a), undefined);
    if (newest) return { level, version: newest.version, url: newest.url, reason: newest.reason };
  }
  return undefined;
}
