// MCP OAuth for "Test connection": the SDK drives discovery, getting a client and PKCE;
// we open the browser and catch the redirect on a loopback server (RFC 8252).
// Kumi gets a client in one of two ways, and the SDK picks: when the authorization server supports client ID
// metadata documents (CIMD), Kumi's client ID is the URL of its hosted metadata document; otherwise Kumi
// registers itself (dynamic client registration).
// Credentials live in memory for this app session only, so a re-test doesn't ask to sign in again.
// A test that isn't interactive goes as far as it can without the user (discovery, registration) and stops
// before the browser, so Kumi can tell whether it could sign in at all.

import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const CALLBACK_PATH = '/callback';

/**
 * Kumi's client ID on authorization servers that support CIMD: the URL of `docs/public/oauth/client-metadata.json`
 * on the docs site. It must never change (every authorization server knows Kumi by it) and must be served
 * directly, with no redirect.
 */
export const CLIENT_METADATA_URL = 'https://tiago.santos.com.pt/kumi/oauth/client-metadata.json';

/** Shared by the hosted metadata document and dynamic registration; only the redirect URI differs (its port). */
export const CLIENT_METADATA: Omit<OAuthClientMetadata, 'redirect_uris'> = {
  client_name: 'Kumi',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

interface Credentials {
  redirectUrl: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
}

/** Per MCP server URL. A registered client is bound to its redirect URL, so both are kept together. */
const store = new Map<string, Credentials>();

export type OpenBrowser = (url: string) => Promise<void>;

export interface SessionOptions {
  openBrowser: OpenBrowser;
  /** Open the sign-in page. When false, the session stops where the browser would open. */
  interactive: boolean;
}

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
  private challenged = false;
  private settle?: { resolve: (code: string) => void; reject: (e: Error) => void };
  private early?: { code?: string; error?: Error };

  private constructor(
    private readonly server: Server,
    private readonly creds: Credentials,
    private readonly options: SessionOptions,
  ) {
    const self = this;
    this.provider = {
      get redirectUrl() {
        return creds.redirectUrl;
      },
      get clientMetadata(): OAuthClientMetadata {
        return { ...CLIENT_METADATA, redirect_uris: [creds.redirectUrl] };
      },
      clientMetadataUrl: CLIENT_METADATA_URL,
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
      // The SDK reads this first thing in `auth()`, which it runs only when the server asks for credentials.
      discoveryState: () => {
        self.challenged = true;
        return creds.discovery;
      },
      invalidateCredentials: (scope) => {
        if (scope === 'all' || scope === 'client') creds.client = undefined;
        if (scope === 'all' || scope === 'tokens') creds.tokens = undefined;
        if (scope === 'all' || scope === 'discovery') creds.discovery = undefined;
        if (scope === 'all' || scope === 'verifier') self.verifier = '';
      },
      redirectToAuthorization: async (url) => {
        self.redirected = true;
        if (self.options.interactive) await self.options.openBrowser(url.toString());
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
  static async start(serverUrl: string, options: SessionOptions): Promise<OAuthSession> {
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
    return new OAuthSession(server, creds, options);
  }

  /** True once the SDK got as far as the authorization page: Kumi has a client and could sign in. */
  get awaitingSignIn(): boolean {
    return this.redirected;
  }

  /** True once the server asked for credentials during this session (the SDK started its OAuth flow). */
  get signInStarted(): boolean {
    return this.challenged;
  }

  /** The authorization server's metadata, once discovery found it. Its absence means the server doesn't speak OAuth. */
  get authServerMetadata(): AuthorizationServerMetadata | undefined {
    return this.creds.discovery?.authorizationServerMetadata;
  }

  /** True when Kumi holds a client for this server, registered now or in an earlier test. */
  get hasClient(): boolean {
    return !!this.creds.client;
  }

  /**
   * True when Kumi's client ID here is its metadata document URL. The server then checks Kumi's client only when
   * the browser opens its sign-in page, and a rejected redirect URI shows an error there instead of coming back.
   */
  get usesMetadataDocument(): boolean {
    return this.creds.client?.client_id === CLIENT_METADATA_URL;
  }

  /** Resolves with the authorization code from the browser redirect. */
  waitForCode(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timedOut = `Sign-in timed out after ${Math.round(timeoutMs / 60_000)} minutes.`;
      const message = this.usesMetadataDocument ? `${timedOut} If the browser showed an error, this server may not accept Kumi's sign-in.` : timedOut;
      const t = setTimeout(() => reject(new Error(message)), timeoutMs);
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
