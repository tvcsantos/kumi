import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeForLog, testServer } from '../src/main/health/check';
import { FileLog, initLog } from '../src/main/log';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kumi-log-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('FileLog', () => {
  it('appends entries with an indented detail block', async () => {
    const log = new FileLog(join(dir, 'logs'));
    await log.write('error', 'test', 'first', 'line a\nline b\n');
    await log.write('info', 'test', 'second');
    const text = readFileSync(log.file, 'utf8');
    expect(text).toMatch(/^\S+Z ERROR \[test\] first\n {4}line a\n {4}line b\n\S+Z INFO {2}\[test\] second\n$/);
  });

  it('moves a full file aside and starts a new one', async () => {
    const log = new FileLog(dir, 200);
    await log.write('info', 'test', 'a'.repeat(150));
    await log.write('info', 'test', 'b'.repeat(150));
    expect(readFileSync(join(dir, 'kumi.old.log'), 'utf8')).toContain('aaa');
    expect(readFileSync(log.file, 'utf8')).not.toContain('aaa');
  });
});

describe('describeForLog', () => {
  it('hides env values, flagged and secret-looking args', () => {
    const text = describeForLog({
      name: 'x',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg', '--api-key', 'k1', '--token=t1', 'plain', 's1'],
      env: { GITHUB_TOKEN: 'ghp_secret', LOG_LEVEL: 'debug' },
      secretArgs: [6],
    });
    expect(text).toContain('command: npx -y pkg --api-key *** --token=*** plain ***');
    expect(text).toContain('env (values hidden): GITHUB_TOKEN, LOG_LEVEL');
    expect(text).not.toMatch(/k1|t1|s1|ghp_secret|debug/);
  });

  it('drops URL credentials and query, and header values', () => {
    const text = describeForLog({
      name: 'x',
      transport: 'streamable-http',
      url: 'https://user:pw@example.com/mcp?key=abc',
      headers: { Authorization: 'Bearer abc' },
    });
    expect(text).toContain('url: https://example.com/mcp?…');
    expect(text).toContain('headers (values hidden): Authorization');
    expect(text).not.toMatch(/pw|abc/);
  });
});

describe('testServer logging', () => {
  it('writes a failed test, with all of its stderr, to the log', async () => {
    const log = initLog(dir);
    const noise = 'x'.repeat(5000);
    const script = `process.stderr.write('START-' + ${JSON.stringify(noise)} + '-END'); process.exit(1)`;
    const res = await testServer({ name: 'broken', transport: 'stdio', command: process.execPath, args: ['-e', script], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(res.ok).toBe(false);
    expect(res.stderr!.length).toBeLessThanOrEqual(4000);
    expect(existsSync(log.file)).toBe(true);
    const text = readFileSync(log.file, 'utf8');
    expect(text).toContain('[test-connection] "broken" failed');
    expect(text).toContain('START-');
    expect(text).toContain('-END');
  });
});
