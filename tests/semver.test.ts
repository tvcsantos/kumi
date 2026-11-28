import { describe, expect, it } from 'vitest';
import { parseVersion, satisfies } from '@shared/semver';

describe('parseVersion', () => {
  it('reads the version out of --version output', () => {
    expect(parseVersion('v22.11.0\n')).toEqual([22, 11, 0]);
    expect(parseVersion('Python 3.12.1')).toEqual([3, 12, 1]);
    expect(parseVersion('Python 3.9')).toEqual([3, 9, 0]);
    expect(parseVersion('nope')).toBeNull();
  });
});

describe('satisfies', () => {
  it.each([
    ['20.18.1', '>=v20.18.1', true],
    ['20.18.0', '>=v20.18.1', false],
    ['3.12.1', '>=3.8,<4.0', true],
    ['4.0.0', '>=3.8,<4.0', false],
    ['1.9.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.5.0', '>1.0.0 <2.0.0', true],
    ['20.1.0', '18 || 20', true],
    ['19.0.0', '18 || 20', false],
    ['16.0.0', '>= 16.0.0', true],
    ['22.0.0', '*', true],
    ['1.2.0', '1.2.x', true],
    ['1.3.0', '1.2.x', false],
    ['3.0.0', '>2', true],
    ['2.9.0', '>2', false],
  ])('%s in %s → %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it("says nothing when it can't read the range or the version", () => {
    expect(satisfies('20.0.0', 'lts/iron')).toBeUndefined();
    expect(satisfies('unknown', '>=20')).toBeUndefined();
  });
});
