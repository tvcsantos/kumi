import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '../src/main/health/check';
import { CLIENT_METADATA, CLIENT_METADATA_URL, clearOAuthCredentials, OAuthSession } from '../src/main/health/oauth';

const TOKEN = 'access-123';

async function body(req: IncomingMessage): Promise<string> {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s;
}

interface MockOptions {
  /** `open` accepts dynamic registration, `forbidden` refuses it (like Figma), `none` doesn't offer it. */
  registration?: 'open' | 'forbidden' | 'none';
  /** False: the server answers 401 but publishes no OAuth metadata (it wants an API key). */
  oauth?: boolean;
  /** True: the authorization server accepts client ID metadata documents (CIMD). */
  cimd?: boolean;
}

/** A remote MCP server behind a minimal OAuth authorization server (discovery, DCR or CIMD, PKCE code flow). */
function mockServer({ registration = 'open', oauth = true, cimd = false }: MockOptions = {}) {
  const seen = { registrations: 0, verifiers: [] as string[], clientIds: [] as string[] };
  let base = '';
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (!oauth && url.pathname !== '/mcp') return res.writeHead(404).end();
    switch (url.pathname) {
      case '/.well-known/oauth-protected-resource/mcp':
      case '/.well-known/oauth-protected-resource':
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      case '/.well-known/oauth-authorization-server':
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          ...(registration === 'none' ? {} : { registration_endpoint: `${base}/register` }),
          ...(cimd ? { client_id_metadata_document_supported: true } : {}),
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        });
      case '/register':
        seen.registrations++;
        if (registration === 'forbidden') return res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
        if (registration === 'none') return res.writeHead(404).end();
        return json(201, { ...JSON.parse(await body(req)), client_id: 'client-1' });
      case '/authorize': {
        seen.clientIds.push(url.searchParams.get('client_id') ?? '');
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'code-1');
        back.searchParams.set('state', url.searchParams.get('state')!);
        return res.writeHead(302, { Location: back.toString() }).end();
      }
      case '/token': {
        const params = new URLSearchParams(await body(req));
        seen.verifiers.push(params.get('code_verifier') ?? '');
        if (params.get('code') !== 'code-1') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 });
      }
      case '/mcp': {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, oauth ? { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` } : {});
          return res.end();
        }
        const mcp = new McpServer({ name: 'mock', version: '1.0.0' });
        mcp.registerTool('ping', { description: 'Pong' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => void transport.close());
        await mcp.connect(transport);
        return transport.handleRequest(req, res);
      }
      default:
        return res.writeHead(404).end();
    }
  });
  return {
    seen,
    url: () => `${base}/mcp`,
    start: () => new Promise<void>((r) => server.listen(0, '127.0.0.1', () => ((base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`), r()))),
    stop: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

/** Acts as the user's browser: follows the authorization redirect back to Kumi's loopback callback. */
function fakeBrowser() {
  const opened: string[] = [];
  const open = async (url: string) => {
    opened.push(url);
    setTimeout(async () => {
      const res = await fetch(url, { redirect: 'manual' });
      await fetch(res.headers.get('location')!);
    }, 10);
  };
  return { opened, open };
}

const spec = (url: string, headers?: Record<string, string>) => ({ name: 'mock', transport: 'streamable-http' as const, url, headers });

describe('Test connection with OAuth', () => {
  const mock = mockServer();
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());
  afterEach(() => clearOAuthCredentials());

  it('stops before the browser and reports the server as up, with sign-in available', async () => {
    const browser = fakeBrowser();
    const before = mock.seen.registrations;
    const res = await testServer(spec(mock.url()), { openBrowser: browser.open });
    expect(res).toMatchObject({ ok: true, tools: [], signIn: { available: true } });
    expect(res.error).toBeUndefined();
    expect(browser.opened).toHaveLength(0);
    expect(mock.seen.registrations).toBe(before + 1);
  });

  it('signs in through the browser when asked, then lists tools', async () => {
    const browser = fakeBrowser();
    const res = await testServer(spec(mock.url()), { signIn: true, openBrowser: browser.open });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.signIn).toBeUndefined();
    expect(res.tools.map((t) => t.name)).toEqual(['ping']);
    expect(browser.opened).toHaveLength(1);
    const auth = new URL(browser.opened[0]);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(mock.seen.verifiers.at(-1)).toBeTruthy();
  });

  it('reuses the client registered by a plain test when signing in', async () => {
    await testServer(spec(mock.url()), { openBrowser: fakeBrowser().open });
    const before = mock.seen.registrations;
    const res = await testServer(spec(mock.url()), { signIn: true, openBrowser: fakeBrowser().open });
    expect(res.tools.map((t) => t.name)).toEqual(['ping']);
    expect(mock.seen.registrations).toBe(before);
  });

  it('lists tools on a plain test once signed in this session', async () => {
    await testServer(spec(mock.url()), { signIn: true, openBrowser: fakeBrowser().open });
    const again = fakeBrowser();
    const res = await testServer(spec(mock.url()), { openBrowser: again.open });
    expect(res.ok).toBe(true);
    expect(res.signIn).toBeUndefined();
    expect(res.tools.map((t) => t.name)).toEqual(['ping']);
    expect(again.opened).toHaveLength(0);
  });

  it('reports a declined sign-in', async () => {
    const res = await testServer(spec(mock.url()), {
      signIn: true,
      openBrowser: async (url: string) => {
        const back = new URL(new URL(url).searchParams.get('redirect_uri')!);
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('state', new URL(url).searchParams.get('state')!);
        setTimeout(() => void fetch(back), 10);
      },
    });
    expect(res).toMatchObject({ ok: false, error: 'Sign-in failed: access_denied' });
  });

  it('skips OAuth when an Authorization header is configured', async () => {
    const browser = fakeBrowser();
    const res = await testServer(spec(mock.url(), { Authorization: 'Bearer wrong' }), { openBrowser: browser.open });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Check your API key or token/);
    expect(browser.opened).toHaveLength(0);
  });
});

describe('Test connection with a client ID metadata document (CIMD)', () => {
  const mock = mockServer({ cimd: true });
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());
  afterEach(() => clearOAuthCredentials());

  it('signs in with the metadata document URL as client ID, without registering', async () => {
    const browser = fakeBrowser();
    const before = mock.seen.registrations;
    const res = await testServer(spec(mock.url()), { signIn: true, openBrowser: browser.open });
    expect(res.error).toBeUndefined();
    expect(res.tools.map((t) => t.name)).toEqual(['ping']);
    expect(new URL(browser.opened[0]).searchParams.get('client_id')).toBe(CLIENT_METADATA_URL);
    expect(mock.seen.clientIds.at(-1)).toBe(CLIENT_METADATA_URL);
    expect(mock.seen.registrations).toBe(before);
  });

  it('says the server may not accept Kumi when a CIMD sign-in times out', async () => {
    const session = await OAuthSession.start(mock.url(), { openBrowser: async () => {}, interactive: false });
    try {
      await session.provider.saveClientInformation!({ client_id: CLIENT_METADATA_URL });
      await expect(session.waitForCode(10)).rejects.toThrow(/timed out.*may not accept Kumi's sign-in/);
    } finally {
      session.close();
    }
  });
});

describe('Kumi\'s hosted client metadata document', () => {
  const hosted = JSON.parse(readFileSync(join(__dirname, '../docs/public/oauth/client-metadata.json'), 'utf8'));

  it('is served at the URL Kumi uses as its client ID', () => {
    expect(hosted.client_id).toBe(CLIENT_METADATA_URL);
    // The docs site serves docs/public at its root.
    expect(CLIENT_METADATA_URL).toMatch(/^https:\/\/[^/]+\/kumi\/oauth\/client-metadata\.json$/);
  });

  it('matches what Kumi registers, apart from the redirect port', () => {
    expect(hosted).toMatchObject(CLIENT_METADATA);
    expect(hosted.redirect_uris).toEqual(['http://127.0.0.1/callback']);
  });
});

describe('Test connection with OAuth that Kumi can\'t use', () => {
  afterEach(() => clearOAuthCredentials());

  async function withMock<T>(options: MockOptions, run: (m: ReturnType<typeof mockServer>) => Promise<T>): Promise<T> {
    const m = mockServer(options);
    await m.start();
    try {
      return await run(m);
    } finally {
      await m.stop();
    }
  }

  it('reports a server that refuses registration as up, without sign-in', async () => {
    await withMock({ registration: 'forbidden' }, async (m) => {
      const browser = fakeBrowser();
      const res = await testServer(spec(m.url()), { openBrowser: browser.open });
      expect(res).toMatchObject({ ok: true, tools: [], signIn: { available: false, reason: "It doesn't let other apps register with it." } });
      expect(m.seen.registrations).toBeGreaterThan(0);
      expect(browser.opened).toHaveLength(0);
    });
  });

  it('reports a server without registration as up, without sign-in', async () => {
    await withMock({ registration: 'none' }, async (m) => {
      const res = await testServer(spec(m.url()), { openBrowser: fakeBrowser().open });
      expect(res).toMatchObject({ ok: true, signIn: { available: false, reason: 'It only accepts apps registered with it in advance.' } });
      expect(m.seen.registrations).toBe(0);
    });
  });

  it('reports a server that offers only CIMD as up, with sign-in available', async () => {
    await withMock({ registration: 'none', cimd: true }, async (m) => {
      const browser = fakeBrowser();
      const res = await testServer(spec(m.url()), { openBrowser: browser.open });
      expect(res).toMatchObject({ ok: true, tools: [], signIn: { available: true } });
      expect(browser.opened).toHaveLength(0);
      expect(m.seen.registrations).toBe(0);
    });
  });

  it('fails a server that answers 401 without OAuth metadata', async () => {
    await withMock({ oauth: false }, async (m) => {
      const res = await testServer(spec(m.url()), { openBrowser: fakeBrowser().open });
      expect(res.ok).toBe(false);
      expect(res.signIn).toBeUndefined();
      expect(res.error).toMatch(/offers no OAuth sign-in.*Check your API key or token/);
    });
  });

  it("doesn't call a server up from an earlier test once it's gone", async () => {
    const m = mockServer({ registration: 'forbidden' });
    await m.start();
    const url = m.url();
    expect((await testServer(spec(url), { openBrowser: fakeBrowser().open })).signIn).toBeDefined();
    await m.stop();
    const res = await testServer(spec(url), { openBrowser: fakeBrowser().open });
    expect(res.ok).toBe(false);
    expect(res.signIn).toBeUndefined();
  });
});
