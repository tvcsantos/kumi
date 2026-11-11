// JSON over HTTP with retries and one disk cache shared by every registry, so browsing works offline.

import { join } from 'node:path';
import { atomicWrite, readTextOrNull } from '../config-io/fs';

// The registry sometimes takes ~15s to answer; don't abort just before it does.
const TIMEOUT_MS = 25_000;
const FRESH_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  at: number;
  data: unknown;
}

export type Fetch = typeof fetch;

/** A request that failed. `status` is set when the server answered; `permanent` failures aren't retried. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly permanent = false,
  ) {
    super(message);
  }
}

const MAX_DETAIL = 300;

/** What the server said, in one short line: the `error`/`message` of a JSON body, or its text. Empty for HTML pages. */
export async function responseDetail(res: Response): Promise<string> {
  let text: string;
  try {
    text = (await res.text()).trim();
  } catch {
    return '';
  }
  if (!text) return '';
  if (/^<(!doctype|html)/i.test(text)) return 'the server sent an HTML page';
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['error_description', 'message', 'error', 'detail', 'title']) {
      const v = body?.[key];
      if (typeof v === 'string' && v.trim()) {
        text = v;
        break;
      }
      if (v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string') {
        text = (v as { message: string }).message;
        break;
      }
    }
  } catch {
    // not JSON: use the text as is
  }
  text = text.replace(/\s+/g, ' ');
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
}

/** The real reason behind fetch's generic "fetch failed": DNS, refused connection, TLS, timeout. */
export function networkReason(e: unknown): string {
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return `no answer after ${TIMEOUT_MS / 1000}s`;
  let err: unknown = e;
  // undici wraps the system error in `cause`, sometimes twice.
  while (err instanceof Error && err.cause instanceof Error) err = err.cause;
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
}

export interface GetOptions {
  /** Extra request headers, e.g. the registry's `Authorization` or API key. */
  headers?: Record<string, string>;
  /** Skip the cache entirely: no fresh or stale hits, nothing stored. Used to check a registry before saving it. */
  noCache?: boolean;
  /** What a 404 means here, e.g. "Registry file not found". */
  notFound?: string;
}

export class HttpCache {
  private cache: Record<string, CacheEntry> | null = null;
  private readonly cachePath: string;

  constructor(
    dataDir: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.cachePath = join(dataDir, 'cache', 'registry.json');
  }

  private async loadCache(): Promise<Record<string, CacheEntry>> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse((await readTextOrNull(this.cachePath)) ?? '{}');
      } catch {
        this.cache = {};
      }
    }
    return this.cache!;
  }

  private async saveCache() {
    const cache = await this.loadCache();
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const k of keys.slice(MAX_CACHE_ENTRIES)) delete cache[k];
    await atomicWrite(this.cachePath, JSON.stringify(cache)).catch(() => {});
  }

  /** Fresh cache → network (with retries) → stale cache. */
  async getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
    const cache = await this.loadCache();
    const hit = opts.noCache ? undefined : cache[url];
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.data as T;

    // Lower-case the names so a custom header replaces ours rather than being merged into it.
    const headers: Record<string, string> = { accept: 'application/json' };
    for (const [name, value] of Object.entries(opts.headers ?? {})) headers[name.toLowerCase()] = value;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let res: Response;
        try {
          res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers });
        } catch (e) {
          throw new HttpError(`Couldn't reach ${url}: ${networkReason(e)}`);
        }
        if (!res.ok) {
          let detail = await responseDetail(res);
          if (detail.toLowerCase() === res.statusText.toLowerCase()) detail = '';
          const said = `${url} answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? `: ${detail}` : ''}`;
          if (res.status === 404) throw new HttpError(`${opts.notFound ?? 'Not found'}. ${said}`, 404, true);
          if (res.status === 401 || res.status === 403) {
            throw new HttpError(`Access denied. ${said}. Check the registry's headers.`, res.status, true);
          }
          throw new HttpError(said, res.status);
        }
        const text = await res.text();
        let data: T;
        try {
          data = JSON.parse(text) as T;
        } catch {
          const type = res.headers.get('content-type');
          throw new HttpError(`${url} didn't answer with JSON${type ? ` (content-type: ${type})` : ''}.`, res.status, true);
        }
        if (!opts.noCache) {
          cache[url] = { at: Date.now(), data };
          void this.saveCache();
        }
        return data;
      } catch (e) {
        lastError = e;
        if (e instanceof HttpError && e.permanent) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    console.warn(`[registry] GET ${url} failed${hit ? ', using the cached copy' : ''}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    if (hit) return hit.data as T;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
