import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstallRequest, ServerSpec } from '@shared/types';
import type { HostEnv } from '../src/main/clients/types';
import { InstallService } from '../src/main/install/service';
import { BackupService } from '../src/main/state/backups';
import { StateStore } from '../src/main/state/store';
import type { SecretBox } from '../src/main/secrets/secrets';

let root: string;
let env: HostEnv;
let service: InstallService;
let backups: BackupService;

const fakeBox: SecretBox = {
  available: async () => true,
  encrypt: async (s: string) => Buffer.from(s).toString('base64'),
  decrypt: async (s: string) => Buffer.from(s, 'base64').toString(),
};

const spec: ServerSpec = {
  name: 'context7',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@upstash/context7-mcp@1.0.0'],
  env: { CONTEXT7_API_KEY: 'sk-secret-value' },
  secretEnv: ['CONTEXT7_API_KEY'],
};

const request = (over: Partial<InstallRequest> = {}): InstallRequest => ({
  spec,
  targets: [
    { clientId: 'cursor', scope: { kind: 'user' } },
    { clientId: 'codex', scope: { kind: 'user' } },
  ],
  secretsMode: 'inline',
  values: { 'env.CONTEXT7_API_KEY': 'sk-secret-value', other: 'x' },
  secretValueKeys: ['env.CONTEXT7_API_KEY'],
  ...over,
});

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'kumi-test-'));
  const home = join(root, 'home');
  env = {
    home,
    platform: 'darwin',
    appData: join(home, 'AppData'),
    localAppData: join(home, 'Local'),
    xdgConfig: join(home, '.config'),
    vars: {},
    which: async (bin) => (bin === 'npx' ? '/usr/bin/npx' : null),
    exists: async (p) => fs.access(p).then(() => true, () => false),
  };
  const data = join(root, 'data');
  backups = new BackupService(data);
  service = new InstallService(env, new StateStore(data), backups, fakeBox);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('InstallService', () => {
  it('plans with masked diffs, applies, records, and uninstalls', async () => {
    const plan = await service.plan(request());
    expect(plan.changes.map((c) => c.error)).toEqual([undefined, undefined]);
    const diffText = plan.changes.flatMap((c) => c.diff.map((l) => l.text)).join('\n');
    expect(diffText).not.toContain('sk-secret-value');
    expect(diffText).toContain('••••••••');

    const results = await service.apply(plan.id);
    expect(results.every((r) => r.ok)).toBe(true);
    const cursorFile = await fs.readFile(join(env.home, '.cursor', 'mcp.json'), 'utf8');
    expect(cursorFile).toContain('sk-secret-value');

    const view = await service.listInstalled();
    expect(view.entries.map((e) => [e.clientId, e.name, !!e.record])).toEqual([
      ['cursor', 'context7', true],
      ['codex', 'context7', true],
    ]);
    const record = view.entries[0].record!;
    expect(record.values).toEqual({ other: 'x' });
    expect(await service.recordValues(record.id)).toEqual({ other: 'x', 'env.CONTEXT7_API_KEY': 'sk-secret-value' });

    const removed = await service.uninstall({ clientId: 'cursor', scope: { kind: 'user' }, name: 'context7' });
    expect(removed.ok).toBe(true);
    expect((await service.listInstalled()).entries.map((e) => e.clientId)).toEqual(['codex']);
  });

  it('still records the install when the keychain fails to encrypt, just without the secrets', async () => {
    // macOS can report the keychain available and then fail, e.g. when HOME has no login keychain.
    const brokenBox: SecretBox = { ...fakeBox, encrypt: async () => Promise.reject(new Error('Error while encrypting')) };
    service = new InstallService(env, new StateStore(join(root, 'data')), backups, brokenBox);

    const results = await service.apply((await service.plan(request())).id);
    expect(results.map((r) => [r.ok, r.error])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    const record = (await service.listInstalled()).entries[0].record!;
    expect(record.encryptedSecrets).toBeUndefined();
    expect(await service.recordValues(record.id)).toEqual({ other: 'x' });
  });

  it('refuses to overwrite servers it does not own unless asked', async () => {
    const path = join(env.home, '.cursor', 'mcp.json');
    await fs.mkdir(join(env.home, '.cursor'), { recursive: true });
    await fs.writeFile(path, '{ "mcpServers": { "context7": { "command": "mine" } } }\n');

    const plan = await service.plan(request({ targets: [{ clientId: 'cursor', scope: { kind: 'user' } }] }));
    expect(plan.changes[0].error).toMatch(/wasn't installed by Kumi/);

    const forced = await service.plan(request({ targets: [{ clientId: 'cursor', scope: { kind: 'user' } }], overwriteForeign: true }));
    expect(forced.changes[0]).toMatchObject({ replaces: true, foreign: true });
    expect(forced.changes[0].error).toBeUndefined();

    const removal = await service.uninstall({ clientId: 'cursor', scope: { kind: 'user' }, name: 'context7' });
    expect(removal.ok).toBe(false);
  });

  it('does not write when the file changed after the preview', async () => {
    const plan = await service.plan(request({ targets: [{ clientId: 'cursor', scope: { kind: 'user' } }] }));
    await fs.mkdir(join(env.home, '.cursor'), { recursive: true });
    await fs.writeFile(join(env.home, '.cursor', 'mcp.json'), '{}\n');
    const [result] = await service.apply(plan.id);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/changed since the preview/) });
    expect(await fs.readFile(join(env.home, '.cursor', 'mcp.json'), 'utf8')).toBe('{}\n');
  });

  it('chains user and local scopes that share ~/.claude.json', async () => {
    const projectDir = join(root, 'repo');
    const plan = await service.plan(
      request({
        targets: [
          { clientId: 'claude-code', scope: { kind: 'user' } },
          { clientId: 'claude-code', scope: { kind: 'local', projectDir } },
        ],
      }),
    );
    const results = await service.apply(plan.id);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const json = JSON.parse(await fs.readFile(join(env.home, '.claude.json'), 'utf8'));
    expect(json.mcpServers.context7).toBeDefined();
    expect(json.projects[projectDir].mcpServers.context7).toBeDefined();
    expect((await service.listInstalled()).entries.filter((e) => e.record)).toHaveLength(2);
  });

  it('backs up before writing and restores', async () => {
    const path = join(env.home, '.cursor', 'mcp.json');
    await fs.mkdir(join(env.home, '.cursor'), { recursive: true });
    await fs.writeFile(path, '{\n  // original\n}\n');
    const plan = await service.plan(request({ targets: [{ clientId: 'cursor', scope: { kind: 'user' } }] }));
    await service.apply(plan.id);
    const [backup] = await backups.list();
    expect(backup).toMatchObject({ clientId: 'cursor', originalPath: path, existed: true });
    await backups.restore(backup.id);
    expect(await fs.readFile(path, 'utf8')).toBe('{\n  // original\n}\n');
  });

  it('reports malformed configs instead of touching them', async () => {
    await fs.mkdir(join(env.home, '.cursor'), { recursive: true });
    await fs.writeFile(join(env.home, '.cursor', 'mcp.json'), '{ broken');
    const plan = await service.plan(request({ targets: [{ clientId: 'cursor', scope: { kind: 'user' } }] }));
    expect(plan.changes[0].error).toMatch(/Invalid JSON/);
    expect((await service.listInstalled()).errors).toHaveLength(1);
  });
});
