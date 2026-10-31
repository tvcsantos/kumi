import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RegistryServer } from '@shared/registry';
import { getVariants, initialValues, maskSpec, resolveVariant, suggestName, validateValues } from '@shared/variants';

const servers: RegistryServer[] = JSON.parse(readFileSync(join(__dirname, 'fixtures/registry/servers.json'), 'utf8'));
const byName = (name: string) => servers.find((s) => s.name === name)!;

describe('getVariants', () => {
  it('lists packages then remotes and flags unsupported ones', () => {
    const variants = getVariants(byName('io.github.upstash/context7'));
    expect(variants.map((v) => [v.ref.kind, v.transport, !!v.unsupported])).toEqual([
      ['package', 'stdio', false],
      ['package', 'stdio', true], // mcpb
      ['remote', 'streamable-http', false],
    ]);
    expect(variants[0].fields.map((f) => [f.id, f.secret, f.required])).toEqual([['env.CONTEXT7_API_KEY', true, false]]);
    expect(variants[0].runtime).toBe('npx');
  });

  it('turns templated values into one field per placeholder', () => {
    const [docker] = getVariants(byName('io.github.github/github-mcp-server'));
    expect(docker.fields.map((f) => [f.id, f.secret])).toEqual([['rt.2.token', true]]);
  });

  it('exposes remote url variables', () => {
    const remote = getVariants(byName('ai.autorfp/mcp')).find((v) => v.ref.kind === 'remote')!;
    const field = remote.fields.find((f) => f.id === 'url.api_host')!;
    expect(field.required).toBe(true);
    expect(field.choices).toContain('api.eu.autorfp.ai');
  });
});

describe('resolveVariant', () => {
  it('builds an npx command with pinned version and env', () => {
    const server = byName('io.github.upstash/context7');
    const res = resolveVariant(server, { kind: 'package', index: 0 }, 'context7', { 'env.CONTEXT7_API_KEY': 'sk-123' });
    expect(res).toEqual({
      ok: true,
      spec: {
        name: 'context7',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', `@upstash/context7-mcp@${server.version}`],
        env: { CONTEXT7_API_KEY: 'sk-123' },
        secretEnv: ['CONTEXT7_API_KEY'],
      },
    });
  });

  it('omits optional empty env vars', () => {
    const res = resolveVariant(byName('io.github.upstash/context7'), { kind: 'package', index: 0 }, 'c7', {});
    expect(res.ok && res.spec.env).toBeUndefined();
  });

  it('builds docker run args and drops optional templated args when empty', () => {
    const server = byName('io.github.github/github-mcp-server');
    const without = resolveVariant(server, { kind: 'package', index: 0 }, 'github', {});
    expect(without.ok && without.spec.args).toEqual([
      'run', '-i', '--rm',
      '-p', '127.0.0.1:8085:8085',
      '-e', 'GITHUB_OAUTH_CALLBACK_PORT=8085',
      'ghcr.io/github/github-mcp-server:2.0.3',
    ]);
    const withToken = resolveVariant(server, { kind: 'package', index: 0 }, 'github', { 'rt.2.token': 'ghp_x' });
    expect(withToken.ok).toBe(true);
    if (!withToken.ok) return;
    expect(withToken.spec.args).toContain('GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x');
    expect(maskSpec(withToken.spec).args).not.toContain('GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x');
  });

  it('places runtime args before the package ref and package args after', () => {
    const server = byName('ai.aquex/stage1');
    const res = resolveVariant(server, { kind: 'package', index: 0 }, 'stage1', { 'pkg.1': '/tmp/out' });
    expect(res.ok && res.spec.args).toEqual(['-y', '--package', `@aquex/stage1@${server.packages![0].version}`, 'stage1-mcp', '--out', '/tmp/out']);
  });

  it('reports missing required values', () => {
    const res = resolveVariant(byName('ai.aquex/stage1'), { kind: 'package', index: 0 }, 'stage1', {});
    expect(res).toEqual({ ok: false, error: 'Missing required: --out' });
  });

  it('fills remote url variables and secret headers', () => {
    const server = byName('io.github.upstash/context7');
    const res = resolveVariant(server, { kind: 'remote', index: 0 }, 'c7', { 'header.Authorization': 'Bearer k' });
    expect(res).toEqual({
      ok: true,
      spec: { name: 'c7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp', headers: { Authorization: 'Bearer k' }, secretHeaders: ['Authorization'] },
    });
    const rfp = resolveVariant(byName('ai.autorfp/mcp'), { kind: 'remote', index: 0 }, 'rfp', { 'url.api_host': 'api.eu.autorfp.ai' });
    expect(rfp.ok && rfp.spec.url).toBe('https://api.eu.autorfp.ai/mcp');
  });

  it('rejects invalid server names', () => {
    expect(resolveVariant(byName('io.github.upstash/context7'), { kind: 'package', index: 0 }, 'bad name', {}).ok).toBe(false);
  });
});

describe('form helpers', () => {
  it('validates required, number and choices', () => {
    const remote = getVariants(byName('ai.autorfp/mcp')).find((v) => v.ref.kind === 'remote')!;
    expect(validateValues(remote, initialValues(remote))).toHaveProperty('url.api_host', 'Required');
    expect(validateValues(remote, { ...initialValues(remote), 'url.api_host': 'nope' })['url.api_host']).toMatch(/one of/);
  });

  it('suggests short config names', () => {
    expect(suggestName({ name: 'io.github.github/github-mcp-server' })).toBe('github');
    expect(suggestName({ name: 'io.github.upstash/context7' })).toBe('context7');
    expect(suggestName({ name: 'com.notion/mcp' })).toBe('notion');
    expect(suggestName({ name: 'io.github.microsoft/playwright-mcp' })).toBe('playwright');
    expect(suggestName({ name: 'app.linear/linear' })).toBe('linear');
  });
});
