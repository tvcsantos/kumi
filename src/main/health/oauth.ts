// MCP OAuth for "Test connection": the SDK drives discovery, dynamic client registration and PKCE;
// we open the browser and catch the redirect on a loopback server (RFC 8252).
// Credentials live in memory for this app session only, so a re-test doesn't ask to sign in again.

import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const CALLBACK_PATH = '/callback';

interface Credentials {
  redirectUrl: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
}

/** Per MCP server URL. A registered client is bound to its redirect URL, so both are kept together. */
const store = new Map<string, Credentials>();

export type OpenBrowser = (url: string) => Promise<void>;

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem;text-align:center"><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** One sign-in attempt: a loopback listener plus the provider the SDK transports use. */
export class OAuthSession {
  readonly provider: OAuthClientProvider;
  private verifier = '';
  private expectedState = randomBytes(16).toString('hex');
  private redirected = false;
  private settle?: { resolve: (code: string) => void; reject: (e: Error) => void };
  private early?: { code?: string; error?: Error };

  private constructor(
    private readonly server: Server,
    creds: Credentials,
    private readonly openBrowser: OpenBrowser,
  ) {
    const self = this;
    this.provider = {
      get redirectUrl() {
        return creds.redirectUrl;
      },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: 'Kumi',
          redirect_uris: [creds.redirectUrl],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
      },
      state: () => self.expectedState,
      clientInformation: () => creds.client,
      saveClientInformation: (info) => {
        creds.client = info;
      },
      tokens: () => creds.tokens,
      saveTokens: (tokens) => {
        creds.tokens = tokens;
      },
      saveCodeVerifier: (v) => {
        self.verifier = v;
      },
      codeVerifier: () => self.verifier,
      saveDiscoveryState: (s) => {
        creds.discovery = s;
      },
      discoveryState: () => creds.discovery,
      invalidateCredentials: (scope) => {
        if (scope === 'all' || scope === 'client') creds.client = undefined;
        if (scope === 'all' || scope === 'tokens') creds.tokens = undefined;
        if (scope === 'all' || scope === 'discovery') creds.discovery = undefined;
        if (scope === 'all' || scope === 'verifier') self.verifier = '';
      },
      redirectToAuthorization: async (url) => {
        self.redirected = true;
        await self.openBrowser(url.toString());
      },
    };
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', creds.redirectUrl);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      let outcome: { code?: string; error?: Error };
      if (url.searchParams.get('state') !== this.expectedState) outcome = { error: new Error('Sign-in failed: the response did not match this request.') };
      else if (error) outcome = { error: new Error(`Sign-in failed: ${url.searchParams.get('error_description') ?? error}`) };
      else if (!code) outcome = { error: new Error('Sign-in failed: no authorization code was returned.') };
      else outcome = { code };
      res.writeHead(outcome.code ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(outcome.code ? page('Signed in to Kumi', 'You can close this tab and go back to Kumi.') : page('Sign-in failed', 'Go back to Kumi for details.'));
      this.deliver(outcome);
    });
  }

  /** Starts the loopback listener, reusing the port a stored client was registered with when possible. */
  static async start(serverUrl: string, openBrowser: OpenBrowser): Promise<OAuthSession> {
    const server = createServer();
    let creds = store.get(serverUrl);
    let port: number;
    try {
      port = await listen(server, creds ? Number(new URL(creds.redirectUrl).port) : 0);
    } catch {
      // The old port is taken: register a fresh client on a new one.
      creds = undefined;
      port = await listen(server, 0);
    }
    if (!creds) {
      creds = { redirectUrl: `http://127.0.0.1:${port}${CALLBACK_PATH}` };
      store.set(serverUrl, creds);
    }
    return new OAuthSession(server, creds, openBrowser);
  }

  /** True once the SDK sent the user to the authorization page. */
  get awaitingSignIn(): boolean {
    return this.redirected;
  }

  /** Resolves with the authorization code from the browser redirect. */
  waitForCode(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Sign-in timed out after ${Math.round(timeoutMs / 60_000)} minutes.`)), timeoutMs);
      this.settle = {
        resolve: (c) => (clearTimeout(t), resolve(c)),
        reject: (e) => (clearTimeout(t), reject(e)),
      };
      if (this.early) this.deliver(this.early);
    });
  }

  private deliver(outcome: { code?: string; error?: Error }): void {
    if (!this.settle) {
      this.early ??= outcome;
      return;
    }
    if (outcome.code) this.settle.resolve(outcome.code);
    else this.settle.reject(outcome.error!);
    this.settle = undefined;
  }

  close(): void {
    this.settle?.reject(new Error('Sign-in was cancelled.'));
    this.server.close();
    this.server.closeAllConnections();
  }
}

/** Forgets stored credentials (for tests). */
export function clearOAuthCredentials(): void {
  store.clear();
}
