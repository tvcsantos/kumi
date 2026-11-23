export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers: `rc.1` → ['rc', '1']. Empty for a final release. */
  pre: string[];
}

export function parseVersion(text: string): Version | null;
export function compareVersions(a: Version, b: Version): number;
export function isNewer(candidate: string, current: string): boolean;
export function isPrerelease(version: string): boolean;

export type Level = 'important' | 'required';
export type Platform = 'mac' | 'windows' | 'linux';

export const LEVELS: Level[];
export const PLATFORMS: Platform[];

/** Trailer values, as written on the tag. */
export interface LevelTrailers {
  level?: string;
  reason?: string;
  /** Comma-separated, without spaces. */
  platforms?: string;
}

export function normalizePlatforms(platforms: string | undefined): string | undefined;
export function levelError(trailers: LevelTrailers): string | null;
export function trailerLines(trailers: LevelTrailers): string[];
export function readTrailers(message: string): LevelTrailers;

/** One hidden line in the release notes. */
export interface LevelLine {
  level: Level;
  /** Every older version must update. */
  version: string;
  /** Every platform when absent. */
  platforms?: Platform[];
  reason?: string;
}

export function parseLevelLines(body: string | null | undefined): LevelLine[];
export function formatLevelLines(entries: LevelLine[]): string;
export function carryLevels(previous: LevelLine[], added?: LevelLine[]): LevelLine[];
export function previousRelease<R extends { version: string; draft?: boolean }>(releases: R[], version: string): R | null;
