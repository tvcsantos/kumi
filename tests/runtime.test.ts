import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hint } from '../src/main/health/check';
import { expandWindowsVars, mergePath, parseRegPath } from '../src/main/host';

describe('mergePath', () => {
  it('keeps the first occurrence of each entry and drops empty ones', () => {
    const merged = mergePath(['/a', '/b'].join(delimiter), undefined, ['', '/b', '/c'].join(delimiter));
    expect(merged.split(delimiter)).toEqual(['/a', '/b', '/c']);
  });
});

describe('Windows registry PATH', () => {
  const vars = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me' };

  it('expands %VAR% case-insensitively and leaves unknown ones', () => {
    expect(expandWindowsVars('%SYSTEMROOT%\\system32;%nope%\\bin', vars)).toBe('C:\\Windows\\system32;%nope%\\bin');
  });

  it('reads the Path value out of reg query output', () => {
    const stdout = [
      '',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      '    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\nodejs\\',
      '',
    ].join('\r\n');
    expect(parseRegPath(stdout, vars)).toBe('C:\\Windows\\system32;C:\\Program Files\\nodejs\\');
    expect(parseRegPath('    Path    REG_SZ    C:\\Users\\me\\.local\\bin\r\n', vars)).toBe('C:\\Users\\me\\.local\\bin');
    expect(parseRegPath('ERROR: The system was unable to find the specified registry key or value.', vars)).toBeNull();
  });
});

describe('Test connection hints', () => {
  it('names the runtime to install when a known one is missing', () => {
    expect(hint('spawn npx ENOENT', '', 'npx')).toBe("npx wasn't found on this machine. Install Node.js from https://nodejs.org (includes npx).");
  });

  it('keeps the generic hint for other commands', () => {
    expect(hint('spawn my-server ENOENT', '', 'my-server')).toBe('spawn my-server ENOENT. Is the command installed and on your PATH?');
  });
});
