import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundleHost } from '@shared/mcpb';
import { BundleStore, parseManifest, safeEntryPath } from '../src/main/bundles/store';
import { BackupService } from '../src/main/state/backups';

const host: BundleHost = { platform: 'darwin', home: '/h', desktop: '/h/Desktop', documents: '/h/Documents', downloads: '/h/Downloads', pathSeparator: '/', pathDelimiter: ':' };
const URL_A = 'https://github.com/acme/files/releases/download/v1/files.mcpb';

const manifest = {
  manifest_version: '0.3',
  name: 'files',
  version: '1.0.0',
  description: 'Files',
  author: { name: 'Acme' },
  server: { type: 'node', entry_point: 'server/index.js', mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] } },
};

function zip(files: Zippable): Uint8Array {
  return zipSync(files);
}
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const good = () => zip({ 'manifest.json': strToU8(JSON.stringify(manifest)), server: { 'index.js': strToU8('console.log(1)') } });

let root: string;
let served: Map<string, Uint8Array>;
let requests: string[];
let store: BundleStore;

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  const body = served.get(url);
  if (!body) return new Response('nope', { status: 404, statusText: 'Not Found' });
  return new Response(body, { status: 200 });
}) as typeof fetch;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'kumi-bundles-'));
  served = new Map();
  requests = [];
  store = new BundleStore({ dataDir: root, host: () => host, fetch: fakeFetch });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('BundleStore.prepare', () => {
  it('downloads, checks the hash and unpacks into a folder named by it', async () => {
    const data = good();
    served.set(URL_A, data);
    const b = await store.prepare(URL_A, sha(data));
    expect(b.dir).toBe(join(root, 'bundles', sha(data)));
    expect(b.manifest.name).toBe('files');
    expect(b.host).toEqual(host);
    expect(await fs.readFile(join(b.dir, 'server', 'index.js'), 'utf8')).toBe('console.log(1)');
    const index = JSON.parse(await fs.readFile(join(root, 'bundles', 'index.json'), 'utf8'));
    expect(index[sha(data)]).toMatchObject({ url: URL_A, name: 'files', version: '1.0.0' });
  });

  it('reuses a bundle already on disk', async () => {
    const data = good();
    served.set(URL_A, data);
    await store.prepare(URL_A, sha(data));
    await new BundleStore({ dataDir: root, host: () => host, fetch: fakeFetch }).prepare(URL_A, sha(data));
    expect(requests).toHaveLength(1);
  });

  it('refuses a download that does not match the hash, and keeps nothing', async () => {
    served.set(URL_A, good());
    await expect(store.prepare(URL_A, 'a'.repeat(64))).rejects.toThrow(/doesn't match the hash/);
    expect((await fs.readdir(join(root, 'bundles')).catch(() => [])).filter((n) => !n.endsWith('.json'))).toEqual([]);
  });

  it('refuses entries that escape the folder', async () => {
    const data = zip({ 'manifest.json': strToU8(JSON.stringify(manifest)), '../evil.txt': strToU8('x') });
    served.set(URL_A, data);
    await expect(store.prepare(URL_A, sha(data))).rejects.toThrow(/outside its folder/);
    await expect(fs.access(join(root, 'evil.txt'))).rejects.toThrow();
  });

  it('needs a manifest at the root', async () => {
    const data = zip({ 'readme.txt': strToU8('hi') });
    served.set(URL_A, data);
    await expect(store.prepare(URL_A, sha(data))).rejects.toThrow(/no manifest.json/);
  });

  it('says what went wrong with the download', async () => {
    await expect(store.prepare(URL_A, 'a'.repeat(64))).rejects.toThrow(/github.com answered 404 Not Found/);
    await expect(store.prepare('http://example.com/x.mcpb', 'a'.repeat(64))).rejects.toThrow(/HTTPS/);
  });

  it('makes a binary bundle executable', async () => {
    const m = { ...manifest, server: { type: 'binary', entry_point: 'bin/server', mcp_config: { command: '${__dirname}/bin/server' } } };
    const data = zip({ 'manifest.json': strToU8(JSON.stringify(m)), bin: { server: strToU8('#!/bin/sh\n') } });
    served.set(URL_A, data);
    const b = await store.prepare(URL_A, sha(data));
    expect((await fs.stat(join(b.dir, 'bin', 'server'))).mode & 0o111).toBeTruthy();
  });
});

describe('BundleStore.cleanup and ensure', () => {
  it('removes folders nothing points at, but keeps ones prepared this session', async () => {
    const data = good();
    served.set(URL_A, data);
    await store.prepare(URL_A, sha(data));
    expect(await store.cleanup([])).toEqual([]);
    // A fresh start: nothing pinned.
    const later = new BundleStore({ dataDir: root, host: () => host, fetch: fakeFetch });
    expect(await later.cleanup([sha(data)])).toEqual([]);
    expect(await later.cleanup([])).toEqual([sha(data)]);
    await expect(fs.access(store.dirFor(sha(data)))).rejects.toThrow();
  });

  it('downloads a cleaned-up bundle again from the index', async () => {
    const data = good();
    served.set(URL_A, data);
    await store.prepare(URL_A, sha(data));
    const later = new BundleStore({ dataDir: root, host: () => host, fetch: fakeFetch });
    await later.cleanup([]);
    await later.ensure([sha(data)]);
    expect(await fs.readFile(join(later.dirFor(sha(data)), 'manifest.json'), 'utf8')).toContain('files');
    expect(requests).toHaveLength(2);
  });

  it('fails when a bundle cannot be brought back', async () => {
    await expect(store.ensure(['d'.repeat(64)])).rejects.toThrow(/doesn't know where to download/);
    const data = good();
    served.set(URL_A, data);
    await store.prepare(URL_A, sha(data));
    const later = new BundleStore({ dataDir: root, host: () => host, fetch: fakeFetch });
    await later.cleanup([]);
    served.clear();
    await expect(later.ensure([sha(data)])).rejects.toThrow(/couldn't: Couldn't download/);
  });
});

describe('restoring a backup that uses a bundle', () => {
  it('stops before writing when the bundle cannot be brought back', async () => {
    const backups = new BackupService(root);
    const config = join(root, 'mcp.json');
    const pointing = JSON.stringify({ args: [`${root}/bundles/${'d'.repeat(64)}/x.js`] });
    await fs.writeFile(config, pointing);
    const info = await backups.create('cursor', config, pointing);
    await fs.writeFile(config, '{}');
    await expect(backups.restore(info.id, (c) => store.ensure([...c.matchAll(/bundles\/([a-f0-9]{64})/g)].map((m) => m[1])))).rejects.toThrow();
    expect(await fs.readFile(config, 'utf8')).toBe('{}');
  });
});

describe('parseManifest', () => {
  it('accepts DXT-era manifests and refuses unknown major versions', () => {
    const { manifest_version: _, ...rest } = manifest;
    expect(parseManifest(JSON.stringify({ ...rest, dxt_version: '0.1' })).manifest_version).toBe('0.1');
    expect(() => parseManifest(JSON.stringify({ ...manifest, manifest_version: '1.0' }))).toThrow(/newer than Kumi supports/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, server: { type: 'java' } }))).toThrow(/server.type/);
    expect(() => parseManifest('{')).toThrow(/valid JSON/);
  });
});

describe('safeEntryPath', () => {
  it('keeps entries inside the folder', () => {
    expect(safeEntryPath('/r', 'a/b.js')).toBe(join('/r', 'a', 'b.js'));
    for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:/x', '..\\x', '']) expect(safeEntryPath('/r', bad)).toBeNull();
  });
});
