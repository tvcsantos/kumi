import { describe, expect, it } from 'vitest';
import { bundleCommand, bundleFields, bundleShasIn, bundleVariant, resolveBundle, type BundleHost, type McpbManifest, type PreparedBundle } from '@shared/mcpb';
import type { InstallVariant, RegistryServer } from '@shared/registry';
import { initialValues, resolveVariant, validateValues } from '@shared/variants';

const SHA = 'b'.repeat(64);
const host: BundleHost = {
  platform: 'darwin',
  home: '/Users/me',
  desktop: '/Users/me/Desktop',
  documents: '/Users/me/Documents',
  downloads: '/Users/me/Downloads',
  pathSeparator: '/',
  pathDelimiter: ':',
};

const manifest: McpbManifest = {
  manifest_version: '0.3',
  name: 'files-search',
  version: '1.2.0',
  server: {
    type: 'node',
    entry_point: 'dist/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/dist/index.js', '--max-results', '${user_config.max_results}', '${user_config.allowed_dirs}'],
      env: {
        SEARCH_API_KEY: '${user_config.api_key}',
        SEARCH_REGION: '${user_config.region}',
        SEARCH_VERBOSE: '${user_config.verbose}',
        CACHE_DIR: '${HOME}${/}.cache',
      },
    },
  },
  user_config: {
    api_key: { type: 'string', title: 'API key', sensitive: true, required: true },
    region: { type: 'string', title: 'Region' },
    max_results: { type: 'number', title: 'Max results', default: 20, min: 1, max: 100 },
    verbose: { type: 'boolean', default: false },
    allowed_dirs: { type: 'directory', title: 'Folders', multiple: true, required: true, default: ['${HOME}/Documents', '${DESKTOP}'] },
  },
};

const bundle = (m: McpbManifest = manifest, h: BundleHost = host): PreparedBundle => ({ sha256: SHA, dir: '/data/bundles/' + SHA, manifest: m, host: h });

describe('bundleFields', () => {
  it('turns user_config into form fields', () => {
    const fields = bundleFields(bundle());
    expect(fields.map((f) => [f.id, f.label, f.format, f.secret, f.required, f.default])).toEqual([
      ['cfg.api_key', 'API key', 'string', true, true, undefined],
      ['cfg.region', 'Region', 'string', false, false, undefined],
      ['cfg.max_results', 'Max results', 'number', false, false, '20'],
      ['cfg.verbose', 'verbose', 'boolean', false, false, 'false'],
      ['cfg.allowed_dirs', 'Folders', 'directory', false, true, '/Users/me/Documents\n/Users/me/Desktop'],
    ]);
    expect(fields[2]).toMatchObject({ min: 1, max: 100, group: 'config' });
    expect(fields[4].multiple).toBe(true);
  });

  it('validates number bounds', () => {
    const variant: InstallVariant = { ref: { kind: 'package', index: 0 }, label: '', transport: 'stdio', fields: bundleFields(bundle()) };
    const values = { ...initialValues(variant), 'cfg.api_key': 'k', 'cfg.max_results': '500' };
    expect(validateValues(variant, values)).toEqual({ 'cfg.max_results': 'Must be at most 100' });
  });
});

describe('resolveBundle', () => {
  it('substitutes variables, spreads multiple values and marks secrets', () => {
    const res = resolveBundle(bundle(), 'files', { 'cfg.api_key': 'sk-1', 'cfg.allowed_dirs': '/a\n\n/b c\n', 'cfg.verbose': 'true' });
    expect(res).toEqual({
      ok: true,
      spec: {
        name: 'files',
        transport: 'stdio',
        command: 'node',
        args: [`/data/bundles/${SHA}/dist/index.js`, '--max-results', '20', '/a', '/b c'],
        env: { SEARCH_API_KEY: 'sk-1', SEARCH_VERBOSE: 'true', CACHE_DIR: '/Users/me/.cache' },
        secretEnv: ['SEARCH_API_KEY'],
      },
    });
  });

  it('leaves out env vars and arguments whose optional setting is empty', () => {
    const m: McpbManifest = {
      ...manifest,
      user_config: { ...manifest.user_config, allowed_dirs: { type: 'directory', multiple: true } },
    };
    const res = resolveBundle(bundle(m), 'files', { 'cfg.api_key': 'k', 'cfg.allowed_dirs': '' });
    expect(res.ok && res.spec.args).toEqual([`/data/bundles/${SHA}/dist/index.js`, '--max-results', '20']);
    expect(res.ok && res.spec.env).not.toHaveProperty('SEARCH_REGION');
  });

  it('reports missing required settings', () => {
    expect(resolveBundle(bundle(), 'files', { 'cfg.allowed_dirs': '' })).toEqual({ ok: false, error: 'Missing required: API key, Folders' });
  });

  it('marks arguments carrying a secret', () => {
    const m: McpbManifest = { ...manifest, server: { ...manifest.server, mcp_config: { command: 'node', args: ['x.js', '--token=${user_config.api_key}'] } } };
    const res = resolveBundle(bundle(m), 'files', { 'cfg.api_key': 'sk-2' });
    expect(res.ok && res.spec).toMatchObject({ args: ['x.js', '--token=sk-2'], secretArgs: [1] });
  });

  it('joins a multiple value with the path delimiter inside a larger string', () => {
    const m: McpbManifest = { ...manifest, server: { ...manifest.server, mcp_config: { command: 'node', env: { ROOTS: '${user_config.allowed_dirs}' } } } };
    const res = resolveBundle(bundle(m), 'files', { 'cfg.api_key': 'k', 'cfg.allowed_dirs': '/a\n/b' });
    expect(res.ok && res.spec.env).toEqual({ ROOTS: '/a:/b' });
  });

  it('refuses a bundle made for another platform', () => {
    const m: McpbManifest = { ...manifest, compatibility: { platforms: ['win32', 'linux'] } };
    expect(resolveBundle(bundle(m), 'files', {})).toEqual({ ok: false, error: 'This bundle only runs on Windows, Linux.' });
    const variant = bundleVariant({ ref: { kind: 'package', index: 0 }, label: '', transport: 'stdio', fields: [] }, bundle(m));
    expect(variant.unsupported).toMatch(/only runs on/);
  });
});

describe('bundleCommand', () => {
  it('applies platform overrides: command and args replace, env adds', () => {
    const m: McpbManifest = {
      ...manifest,
      server: {
        type: 'node',
        mcp_config: {
          command: 'node',
          args: ['a.js'],
          env: { A: '1' },
          platform_overrides: { win32: { command: 'node.exe', args: ['b.js'] }, darwin: { env: { B: '2' } } },
        },
      },
    };
    expect(bundleCommand(m, 'win32')).toEqual({ command: 'node.exe', args: ['b.js'], env: { A: '1' } });
    expect(bundleCommand(m, 'darwin')).toEqual({ command: 'node', args: ['a.js'], env: { A: '1', B: '2' } });
    expect(bundleCommand(m, 'linux')).toEqual({ command: 'node', args: ['a.js'], env: { A: '1' } });
  });

  it('runs uv bundles without mcp_config through uv run', () => {
    const m: McpbManifest = { ...manifest, server: { type: 'uv', entry_point: 'src/server.py' } };
    expect(bundleCommand(m, 'darwin')).toEqual({ command: 'uv', args: ['run', '--directory', '${__dirname}', '${__dirname}/src/server.py'], env: undefined });
  });

  it('adds .exe to a bundled binary on Windows', () => {
    const m: McpbManifest = { ...manifest, server: { type: 'binary', entry_point: 'bin/server', mcp_config: { command: '${__dirname}/bin/server' } } };
    expect(bundleCommand(m, 'win32').command).toBe('${__dirname}/bin/server.exe');
    expect(bundleCommand(m, 'darwin').command).toBe('${__dirname}/bin/server');
  });
});

describe('bundleVariant', () => {
  const base: InstallVariant = { ref: { kind: 'package', index: 0 }, label: 'mcpb', transport: 'stdio', fields: [], bundle: { url: 'https://x/y.mcpb', sha256: SHA } };

  it('fills in fields and the runtime once the bundle is known', () => {
    const variant = bundleVariant(base, bundle());
    expect(variant.runtime).toBe('node');
    expect(variant.runtimeRange).toBeUndefined();
    expect(variant.fields).toHaveLength(5);
  });

  it("carries the runtime's version range, except for uv, which picks its own Python", () => {
    const runtimes = { node: '>=20.18.1', python: '>=3.10' };
    expect(bundleVariant(base, bundle({ ...manifest, compatibility: { runtimes } })).runtimeRange).toBe('>=20.18.1');
    const uv: McpbManifest = { ...manifest, server: { type: 'uv', entry_point: 'src/server.py' }, compatibility: { runtimes } };
    const v = bundleVariant(base, bundle(uv));
    expect([v.runtime, v.runtimeRange]).toEqual(['uv', undefined]);
  });
});

describe('resolveVariant with a bundle', () => {
  const server: RegistryServer = {
    name: 'x/files',
    version: '1.2.0',
    packages: [{ registryType: 'mcpb', identifier: 'https://example.com/files.mcpb', fileSha256: SHA, transport: { type: 'stdio' } }],
  };

  it('needs the downloaded bundle, and the right one', () => {
    expect(resolveVariant(server, { kind: 'package', index: 0 }, 'files', {})).toEqual({ ok: false, error: 'The bundle has not been downloaded yet.' });
    expect(resolveVariant(server, { kind: 'package', index: 0 }, 'files', {}, { ...bundle(), sha256: 'c'.repeat(64) }).ok).toBe(false);
    const res = resolveVariant(server, { kind: 'package', index: 0 }, 'files', { 'cfg.api_key': 'k' }, bundle());
    expect(res.ok && res.spec.command).toBe('node');
  });
});

describe('bundleShasIn', () => {
  it('finds bundle folders in config text, escaped Windows paths included', () => {
    const a = 'a'.repeat(64);
    const text = JSON.stringify({ args: [`/Users/me/.kumi/bundles/${a}/dist/index.js`, `C:\\Users\\me\\.kumi\\bundles\\${SHA}\\x.js`, `/bundles/${'c'.repeat(65)}`] });
    expect(bundleShasIn(text)).toEqual([a, SHA]);
  });
});
