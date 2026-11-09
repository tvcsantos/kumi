import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OFFICIAL_REGISTRY_ID, type RegistryServer } from '@shared/registry';
import { Catalog } from '../src/main/catalog/catalog';
import { FileRegistry, parseServerList } from '../src/main/catalog/file';
import { HttpCache, type Fetch } from '../src/main/catalog/http';
import { ApiRegistry, DEFAULT_REGISTRY_URL } from '../src/main/catalog/registry';
import { RegistryStore } from '../src/main/catalog/sources';

let root: string;

const fakeBox = {
  available: () => true,
  encrypt: (s: string) => Buffer.from(s).toString('base64'),
  decrypt: (s: string) => Buffer.from(s, 'base64').toString(),
};

const server = (name: string, version = '1.0.0', extra: Partial<RegistryServer> = {}): RegistryServer => ({ name, version, ...extra });

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Answers from a map of URL → JSON body; anything else is a 404. Records each request. */
function fakeFetch(routes: Record<string, unknown | ((url: string) => Response)>, calls: Call[] = []): Fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[url];
    if (typeof route === 'function') return route(url);
    if (route === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as Fetch;
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'kumi-catalog-'));
});

afterEach(async () => {
  // Cache writes finish in the background, so the folder may still be filling up.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe('parseServerList', () => {
  it('accepts a plain array of server.json objects', () => {
    expect(parseServerList([server('a'), server('b')]).map((r) => r.server.name)).toEqual(['a', 'b']);
  });

  it('accepts the registry list response shape', () => {
    const parsed = parseServerList({ servers: [{ server: server('a'), _meta: { x: 1 } }] });
    expect(parsed[0].server.name).toBe('a');
    expect(parsed[0]._meta).toEqual({ x: 1 });
  });

  it('skips entries without a name or version, and rejects files with none', () => {
    expect(parseServerList([server('a'), { name: 'no-version' }])).toHaveLength(1);
    expect(() => parseServerList([{ hello: 'world' }])).toThrow(/server\.json/);
    expect(() => parseServerList({ nope: true })).toThrow(/list of servers/);
  });
});

describe('FileRegistry', () => {
  const write = async (data: unknown) => {
    const path = join(root, 'servers.json');
    await fs.writeFile(path, JSON.stringify(data));
    return path;
  };

  it('searches name, title and description, and pages with an offset cursor', async () => {
    const path = await write([server('acme/db', '1.0.0', { description: 'Postgres access' }), server('acme/wiki', '1.0.0', { title: 'Wiki' }), server('acme/chat')]);
    const reg = new FileRegistry(new HttpCache(root), path);
    expect((await reg.search('postgres')).servers.map((s) => s.name)).toEqual(['acme/db']);
    expect((await reg.search('WIKI')).servers.map((s) => s.name)).toEqual(['acme/wiki']);

    const first = await reg.search('', undefined, 2);
    expect(first.servers).toHaveLength(2);
    expect(first.nextCursor).toBe('2');
    const second = await reg.search('', first.nextCursor, 2);
    expect(second.servers.map((s) => s.name)).toEqual(['acme/chat']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('lists one version per server and can get a specific one', async () => {
    const path = await write([server('acme/db', '1.0.0'), server('acme/db', '2.0.0')]);
    const reg = new FileRegistry(new HttpCache(root), path);
    expect((await reg.search('')).servers.map((s) => s.version)).toEqual(['2.0.0']);
    expect((await reg.get('acme/db')).version).toBe('2.0.0');
    expect((await reg.get('acme/db', '1.0.0')).version).toBe('1.0.0');
    await expect(reg.get('acme/nope')).rejects.toThrow(/Not found/);
  });

  it('prefers the entry flagged latest over file order', async () => {
    const latest = { 'io.modelcontextprotocol.registry/official': { isLatest: true } };
    const path = await write({ servers: [{ server: server('acme/db', '2.0.0'), _meta: latest }, { server: server('acme/db', '1.0.0') }] });
    expect((await new FileRegistry(new HttpCache(root), path).get('acme/db')).version).toBe('2.0.0');
  });

  it('picks up changes to a local file', async () => {
    const path = await write([server('acme/db')]);
    const reg = new FileRegistry(new HttpCache(root), path);
    expect((await reg.search('')).servers).toHaveLength(1);
    await fs.writeFile(path, JSON.stringify([server('acme/db'), server('acme/wiki')]));
    const later = new Date(Date.now() + 5_000);
    await fs.utimes(path, later, later);
    expect((await reg.search('')).servers).toHaveLength(2);
  });

  it('fetches a remote file with the token', async () => {
    const calls: Call[] = [];
    const http = new HttpCache(root, fakeFetch({ 'https://acme.test/servers.json': [server('acme/db')] }, calls));
    const reg = new FileRegistry(http, 'https://acme.test/servers.json', 'tok');
    expect(await reg.probe()).toBe(1);
    expect(calls[0].headers.authorization).toBe('Bearer tok');
  });
});

describe('ApiRegistry.probe', () => {
  it('finds the versioned base URL when given a bare host', async () => {
    const http = new HttpCache(root, fakeFetch({ 'https://reg.acme.test/v0.1/servers?limit=1': { servers: [] } }));
    expect(await ApiRegistry.probe(http, 'https://reg.acme.test/')).toBe('https://reg.acme.test/v0.1');
  });

  it('explains when nothing answers like a registry', async () => {
    const http = new HttpCache(root, fakeFetch({ 'https://acme.test/servers?limit=1': { hello: 'world' } }));
    await expect(ApiRegistry.probe(http, 'https://acme.test')).rejects.toThrow(/not like an MCP Registry/);
    await expect(ApiRegistry.probe(http, 'https://other.test')).rejects.toThrow(/No MCP Registry API found/);
  });

  it('sends the token and reports a rejected one', async () => {
    const calls: Call[] = [];
    const http = new HttpCache(root, fakeFetch({ 'https://acme.test/v0.1/servers?limit=1': () => new Response('', { status: 401 }) }, calls));
    await expect(ApiRegistry.probe(http, 'https://acme.test/v0.1', 'bad')).rejects.toThrow(/Access denied/);
    expect(calls[0].headers.authorization).toBe('Bearer bad');
  });
});

describe('RegistryStore', () => {
  it('starts with only the official registry', async () => {
    const list = await new RegistryStore(root, fakeBox).list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: OFFICIAL_REGISTRY_ID, builtIn: true, enabled: true, location: DEFAULT_REGISTRY_URL });
  });

  it('stores tokens encrypted and only hands them out in the main process', async () => {
    const store = new RegistryStore(root, fakeBox);
    const added = await store.add({ name: 'Acme', kind: 'api', location: 'https://reg.acme.test/v0.1', token: 'secret-token' });
    expect(added.hasToken).toBe(true);
    expect(added).not.toHaveProperty('token');
    expect(await fs.readFile(join(root, 'registries.json'), 'utf8')).not.toContain('secret-token');
    expect((await store.resolve(added.id))?.token).toBe('secret-token');

    await store.update(added.id, { token: null });
    expect((await store.resolve(added.id))?.token).toBeUndefined();
  });

  it('refuses to send a token over plain http, except to localhost', async () => {
    const store = new RegistryStore(root, fakeBox);
    await expect(store.add({ name: 'Acme', kind: 'api', location: 'http://reg.acme.test', token: 't' })).rejects.toThrow(/https/);
    await expect(store.add({ name: 'Dev', kind: 'api', location: 'http://localhost:8080', token: 't' })).resolves.toMatchObject({ hasToken: true });
    await expect(store.add({ name: 'File', kind: 'file', location: 'relative/servers.json' })).rejects.toThrow(/absolute/);
  });

  it('refuses a token when the keychain is unavailable', async () => {
    const store = new RegistryStore(root, { ...fakeBox, available: () => false });
    await expect(store.add({ name: 'Acme', kind: 'api', location: 'https://reg.acme.test', token: 't' })).rejects.toThrow(/keychain/);
  });

  it('lets the official registry be turned off but not edited or removed', async () => {
    const store = new RegistryStore(root, fakeBox);
    expect((await store.update(OFFICIAL_REGISTRY_ID, { enabled: false })).enabled).toBe(false);
    await expect(store.update(OFFICIAL_REGISTRY_ID, { location: 'https://x.test' })).rejects.toThrow(/on or off/);
    await expect(store.remove(OFFICIAL_REGISTRY_ID)).rejects.toThrow(/can't be removed/);
  });
});

describe('Catalog', () => {
  const OFFICIAL_SEARCH = `${DEFAULT_REGISTRY_URL}/servers?limit=30&version=latest`;

  async function setup(routes: Parameters<typeof fakeFetch>[0], files: RegistryServer[][] = []) {
    const store = new RegistryStore(root, fakeBox);
    const http = new HttpCache(join(root, 'cache-dir'), fakeFetch(routes));
    const catalog = new Catalog(store, http);
    const ids: string[] = [];
    for (const [i, servers] of files.entries()) {
      const path = join(root, `file-${i}.json`);
      await fs.writeFile(path, JSON.stringify(servers));
      ids.push((await catalog.add({ name: `File ${i}`, kind: 'file', location: path })).id);
    }
    return { catalog, store, ids };
  }

  it('merges results from every enabled registry, tagged with where they came from, the user\'s own first', async () => {
    const { catalog, ids } = await setup({ [OFFICIAL_SEARCH]: { servers: [{ server: server('io.github/a') }] } }, [[server('acme/db')]]);
    const page = await catalog.search('');
    expect(page.items.map((i) => [i.registryId, i.server.name])).toEqual([
      [ids[0], 'acme/db'],
      [OFFICIAL_REGISTRY_ID, 'io.github/a'],
    ]);
    expect(page.failures).toBeUndefined();
  });

  it('keeps the same server name from two registries apart', async () => {
    const { catalog, ids } = await setup({}, [[server('shared/name')], [server('shared/name')]]);
    await catalog.update(OFFICIAL_REGISTRY_ID, { enabled: false });
    expect((await catalog.search('')).items.map((i) => i.registryId)).toEqual(ids);
  });

  it('filters to one registry', async () => {
    const { catalog, ids } = await setup({ [OFFICIAL_SEARCH]: { servers: [{ server: server('io.github/a') }] } }, [[server('acme/db')]]);
    expect((await catalog.search('', undefined, ids[0])).items.map((i) => i.server.name)).toEqual(['acme/db']);
  });

  it('pages each registry with its own cursor and drops ones that ran out', async () => {
    const many = Array.from({ length: 35 }, (_, i) => server(`acme/s${String(i).padStart(2, '0')}`));
    const { catalog } = await setup(
      {
        [OFFICIAL_SEARCH]: { servers: [{ server: server('io.github/a') }], metadata: { nextCursor: 'off-2' } },
        [`${DEFAULT_REGISTRY_URL}/servers?limit=30&version=latest&cursor=off-2`]: { servers: [{ server: server('io.github/b') }] },
      },
      [many],
    );
    const first = await catalog.search('');
    expect(first.items).toHaveLength(31);
    const second = await catalog.search('', first.nextCursor);
    expect(second.items.map((i) => i.server.name)).toEqual(['acme/s30', 'acme/s31', 'acme/s32', 'acme/s33', 'acme/s34', 'io.github/b']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('still returns the other registries when one fails, and throws when all do', async () => {
    const { catalog, ids } = await setup({ [OFFICIAL_SEARCH]: () => new Response('', { status: 403 }) }, [[server('acme/db')]]);
    const page = await catalog.search('');
    expect(page.items.map((i) => i.server.name)).toEqual(['acme/db']);
    expect(page.failures).toEqual([{ registryId: OFFICIAL_REGISTRY_ID, error: expect.stringMatching(/Access denied/) }]);

    await fs.rm(join(root, 'file-0.json'));
    await expect(catalog.search('')).rejects.toThrow(/File 0: Registry file not found.*Official MCP Registry: Access denied/);
    await catalog.update(ids[0], { enabled: false });
    await expect(catalog.search('')).rejects.toThrow(/^Access denied/);
  });

  it('skips disabled registries in search but can still get servers from them', async () => {
    const { catalog, ids } = await setup({}, [[server('acme/db')]]);
    await catalog.update(OFFICIAL_REGISTRY_ID, { enabled: false });
    await catalog.update(ids[0], { enabled: false });
    expect((await catalog.search('')).items).toEqual([]);
    expect((await catalog.get(ids[0], 'acme/db')).name).toBe('acme/db');
    await catalog.remove(ids[0]);
    await expect(catalog.get(ids[0], 'acme/db')).rejects.toThrow(/no longer configured/);
  });

  it('checks a registry before saving it, and saves the URL that answered', async () => {
    const { catalog } = await setup({ 'https://reg.acme.test/v0/servers?limit=1': { servers: [] } });
    await expect(catalog.add({ name: 'Broken', kind: 'api', location: 'https://broken.test' })).rejects.toThrow(/No MCP Registry API found/);
    const added = await catalog.add({ name: 'Acme', kind: 'api', location: 'https://reg.acme.test' });
    expect(added.location).toBe('https://reg.acme.test/v0');
    expect(await catalog.list()).toHaveLength(2);
  });
});
