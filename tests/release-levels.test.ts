import { describe, expect, it } from 'vitest';
// The release side (scripts/release-levels.mjs) writes the hidden lines and Kumi
// (src/main/updater/levels.ts) reads them, each with its own code. The last block checks they agree.
import {
  carryLevels,
  formatLevelLines,
  levelError,
  normalizePlatforms,
  parseLevelLines as toolingParse,
  previousRelease,
  readTrailers,
  trailerLines,
  type LevelLine,
} from '../scripts/release-levels.mjs';
import { markersIn, parseLevelLines as appParse, urgencyOf } from '../src/main/updater/levels';

describe('Kumi-Update trailers', () => {
  it('reads the trailers from the last paragraph of a tag message', () => {
    const message = '0.3.2\n\nKumi-Update: required\nKumi-Update-Reason: Fixes a token leak\nkumi-update-platforms: mac, windows\n';
    expect(readTrailers(message)).toEqual({ level: 'required', reason: 'Fixes a token leak', platforms: 'mac,windows' });
    // Only the last paragraph holds trailers, and a one-paragraph message has none.
    expect(readTrailers('0.3.2\n\nKumi-Update: required\n\nSome notes.')).toEqual({ level: undefined, reason: undefined, platforms: undefined });
    expect(readTrailers('Kumi-Update: required')).toEqual({});
  });

  it('ignores the signature of a signed tag', () => {
    const message = '0.3.2\n\nKumi-Update: important\n-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----\n';
    expect(readTrailers(message).level).toBe('important');
  });

  it('accepts what Kumi can use and explains the rest', () => {
    expect(levelError({})).toBeNull();
    expect(levelError({ level: 'required', reason: 'Fixes a token leak', platforms: 'mac,linux' })).toBeNull();
    expect(levelError({ reason: 'why' })).toMatch(/need a level/);
    expect(levelError({ level: 'urgent' })).toMatch(/important or required/);
    expect(levelError({ level: 'required', platforms: 'mac,bsd' })).toMatch(/unknown platform 'bsd'/);
    expect(levelError({ level: 'required', reason: 'a -- b' })).toMatch(/--/);
    expect(levelError({ level: 'required', reason: 'a\nb' })).toMatch(/one line/);
    expect(levelError({ level: 'required', reason: 'x'.repeat(301) })).toMatch(/300/);
    expect(normalizePlatforms(' mac , windows ')).toBe('mac,windows');
    expect(trailerLines({ level: 'important', platforms: 'linux' })).toEqual(['Kumi-Update: important', 'Kumi-Update-Platforms: linux']);
  });
});

const line = (level: LevelLine['level'], version: string, reason?: string, platforms?: LevelLine['platforms']): LevelLine => ({ level, version, reason, platforms });

describe('level lines in release notes', () => {
  it('formats and parses the hidden lines', () => {
    const lines = [line('required', '3.0.0', 'Keychain', ['mac']), line('important', '2.2.0')];
    const body = formatLevelLines(lines);
    expect(body).toBe('<!-- kumi:required 3.0.0 platforms=mac Keychain -->\n<!-- kumi:important 2.2.0 -->');
    expect(toolingParse(`${body}\n\n## What's Changed`)).toEqual(lines);
    expect(formatLevelLines([])).toBe('');
  });

  it('carries requirements forward, pruning what a newer one covers', () => {
    // The timeline from the design: 2.0.0 required, 2.2.0 important on Windows, 3.0.0 required on Mac, 3.1.0 required everywhere.
    const at200 = carryLevels([], [line('required', '2.0.0', 'Token leak')]);
    const at210 = carryLevels(at200);
    expect(at210).toEqual(at200);
    const at220 = carryLevels(at210, [line('important', '2.2.0', 'Zed', ['windows'])]);
    expect(at220).toEqual([line('required', '2.0.0', 'Token leak'), line('important', '2.2.0', 'Zed', ['windows'])]);
    const at300 = carryLevels(at220, [line('required', '3.0.0', 'Keychain', ['mac'])]);
    // 2.0.0 stays: Windows and Linux still need it.
    expect(at300).toEqual([line('required', '3.0.0', 'Keychain', ['mac']), line('required', '2.0.0', 'Token leak'), line('important', '2.2.0', 'Zed', ['windows'])]);
    const at310 = carryLevels(at300, [line('required', '3.1.0', 'Crash')]);
    expect(at310).toEqual([line('required', '3.1.0', 'Crash')]);
    // An important line doesn't replace an older required one; a newer important line replaces an older important one.
    expect(carryLevels([line('required', '1.0.0')], [line('important', '2.0.0')])).toEqual([line('required', '1.0.0'), line('important', '2.0.0')]);
    expect(carryLevels([line('important', '1.0.0', undefined, ['mac'])], [line('important', '2.0.0', undefined, ['mac', 'linux'])])).toEqual([
      line('important', '2.0.0', undefined, ['mac', 'linux']),
    ]);
    // Re-marking the same version keeps one line, with the newer reason.
    expect(carryLevels([line('required', '2.0.0', 'old')], [line('required', '2.0.0', 'new')])).toEqual([line('required', '2.0.0', 'new')]);
  });

  it('carries from the newest older release, and stable ones only from stable ones', () => {
    const releases = [
      { version: '3.2.0-rc.1' },
      { version: '3.1.1' },
      { version: '3.1.0' },
      { version: '3.3.0', draft: true },
      { version: '9.0.0' },
    ];
    expect(previousRelease(releases, '3.2.0')?.version).toBe('3.1.1');
    expect(previousRelease(releases, '3.2.0-rc.2')?.version).toBe('3.2.0-rc.1');
    expect(previousRelease(releases, '3.1.1')?.version).toBe('3.1.0');
    expect(previousRelease(releases, '3.4.0')?.version).toBe('3.1.1');
    expect(previousRelease(releases, '1.0.0')).toBeNull();
  });

  it('gets someone several releases behind past a required one, from the newest notes alone', () => {
    const notes = formatLevelLines([line('required', '3.0.0', 'Keychain', ['mac']), line('required', '2.0.0', 'Token leak'), line('important', '2.2.0', 'Zed', ['windows'])]);
    const on = (version: string, platform: 'mac' | 'windows' | 'linux') => urgencyOf(markersIn(notes, platform, () => 'url'), version, 'stable');
    expect(on('1.0.0', 'windows')).toMatchObject({ level: 'required', version: '2.0.0', reason: 'Token leak' });
    expect(on('2.1.0', 'windows')).toMatchObject({ level: 'important', version: '2.2.0' });
    expect(on('2.1.0', 'mac')).toMatchObject({ level: 'required', version: '3.0.0', reason: 'Keychain' });
    expect(on('2.1.0', 'linux')).toBeUndefined();
    expect(on('2.5.0', 'windows')).toBeUndefined();
  });
});

describe('the line format, between the release side and Kumi', () => {
  const unusable = '<!-- kumi:required soon -->\n<!-- kumi:required 1.0.0 platforms=bsd -->\n<!-- kumi:urgent 1.0.0 -->';
  const cases: LevelLine[][] = [
    [],
    [line('required', '2.0.0')],
    [line('required', '3.0.0', 'Keychain', ['mac']), line('required', '2.0.0', 'Token leak'), line('important', '2.2.0', 'Zed', ['windows'])],
    [line('important', '0.4.0-rc.1', 'Reason with = and: punctuation', ['mac', 'windows', 'linux'])],
    [line('required', '1.0.0', 'x'.repeat(300))],
  ];

  it('Kumi reads back exactly what the release side writes', () => {
    for (const lines of cases) {
      const notes = `${formatLevelLines(lines)}\n\n## What's Changed\n* Something by someone`;
      expect(appParse(notes)).toEqual(lines);
    }
  });

  it('and reads the lines the release side carries forward', () => {
    const carried = carryLevels(carryLevels([], [line('required', '2.0.0', 'Token leak')]), [line('important', '2.2.0', 'Zed', ['windows'])]);
    expect(appParse(formatLevelLines(carried))).toEqual(carried);
  });

  it('both sides skip the same unusable lines', () => {
    expect(appParse(unusable)).toEqual([]);
    expect(toolingParse(unusable)).toEqual([]);
    const mixed = `${unusable}\n<!-- kumi:important v1.2.3 platforms=linux Fine -->`;
    expect(appParse(mixed)).toEqual(toolingParse(mixed));
    expect(appParse(mixed)).toEqual([line('important', '1.2.3', 'Fine', ['linux'])]);
  });
});
