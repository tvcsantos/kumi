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

export interface GetOptions {
  /** Sent as a bearer token. */
  token?: string;
  /** Skip the cache entirely: no fresh or stale hits, nothing stored. Used to check a registry before saving it. */
  noCache?: boolean;
  /** Error message for a 404. */
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

    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers });
        if (res.status === 404) throw Object.assign(new Error(opts.notFound ?? 'Not found'), { permanent: true });
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Access denied (HTTP ${res.status}). Check the token.`), { permanent: true });
        if (!res.ok) throw new Error(`Registry returned HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (!opts.noCache) {
          cache[url] = { at: Date.now(), data };
          void this.saveCache();
        }
        return data;
      } catch (e) {
        lastError = e;
        if ((e as { permanent?: boolean }).permanent) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    if (hit) return hit.data as T;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
