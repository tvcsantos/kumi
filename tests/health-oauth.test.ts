import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '../src/main/health/check';
import { clearOAuthCredentials } from '../src/main/health/oauth';

const TOKEN = 'access-123';

async function body(req: IncomingMessage): Promise<string> {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s;
}

/** A remote MCP server behind a minimal OAuth authorization server (discovery, DCR, PKCE code flow). */
function mockServer() {
  const seen = { registrations: 0, verifiers: [] as string[] };
  let base = '';
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    switch (url.pathname) {
      case '/.well-known/oauth-protected-resource/mcp':
      case '/.well-known/oauth-protected-resource':
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      case '/.well-known/oauth-authorization-server':
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        });
      case '/register':
        seen.registrations++;
        return json(201, { ...JSON.parse(await body(req)), client_id: 'client-1' });
      case '/authorize': {
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
          res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
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

describe('Test connection with OAuth', () => {
  const mock = mockServer();
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());
  afterEach(() => clearOAuthCredentials());

  it('signs in through the browser, then lists tools', async () => {
    const browser = fakeBrowser();
    const res = await testServer({ name: 'mock', transport: 'streamable-http', url: mock.url() }, browser.open);
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.tools.map((t) => t.name)).toEqual(['ping']);
    expect(browser.opened).toHaveLength(1);
    const auth = new URL(browser.opened[0]);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(mock.seen.verifiers.at(-1)).toBeTruthy();
  });

  it('reuses the session tokens on the next test', async () => {
    const first = fakeBrowser();
    await testServer({ name: 'mock', transport: 'streamable-http', url: mock.url() }, first.open);
    const again = fakeBrowser();
    const res = await testServer({ name: 'mock', transport: 'streamable-http', url: mock.url() }, again.open);
    expect(res.ok).toBe(true);
    expect(again.opened).toHaveLength(0);
  });

  it('reports a declined sign-in', async () => {
    const res = await testServer({ name: 'mock', transport: 'streamable-http', url: mock.url() }, async (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri')!);
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('state', new URL(url).searchParams.get('state')!);
      setTimeout(() => void fetch(back), 10);
    });
    expect(res).toMatchObject({ ok: false, error: 'Sign-in failed: access_denied' });
  });

  it('skips OAuth when an Authorization header is configured', async () => {
    const browser = fakeBrowser();
    const res = await testServer({ name: 'mock', transport: 'streamable-http', url: mock.url(), headers: { Authorization: 'Bearer wrong' } }, browser.open);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Check your API key or token/);
    expect(browser.opened).toHaveLength(0);
  });
});
