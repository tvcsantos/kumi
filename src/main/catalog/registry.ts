// Client for the official MCP Registry, with retries and a disk cache so browsing works offline.

import { join } from 'node:path';
import type { CatalogPage, RegistryServer, RegistryServerResponse } from '@shared/registry';
import { atomicWrite, readTextOrNull } from '../config-io/fs';

export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0.1';

// The registry sometimes takes ~15s to answer; don't abort just before it does.
const TIMEOUT_MS = 25_000;
const FRESH_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  at: number;
  data: unknown;
}

type Fetch = typeof fetch;

function isActive(r: RegistryServerResponse): boolean {
  const meta = r._meta?.['io.modelcontextprotocol.registry/official'] as { status?: string } | undefined;
  return !meta?.status || meta.status === 'active';
}

export class RegistryClient {
  private cache: Record<string, CacheEntry> | null = null;
  private readonly cachePath: string;

  constructor(
    dataDir: string,
    private baseUrl = DEFAULT_REGISTRY_URL,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.cachePath = join(dataDir, 'cache', 'registry.json');
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
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
  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const cache = await this.loadCache();
    const hit = cache[url];
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.data as T;

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
        if (res.status === 404) throw Object.assign(new Error('Not found in the registry'), { permanent: true });
        if (!res.ok) throw new Error(`Registry returned HTTP ${res.status}`);
        const data = (await res.json()) as T;
        cache[url] = { at: Date.now(), data };
        void this.saveCache();
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

  async search(query: string, cursor?: string, limit = 30): Promise<CatalogPage> {
    const params = new URLSearchParams({ limit: String(limit), version: 'latest' });
    if (query.trim()) params.set('search', query.trim());
    if (cursor) params.set('cursor', cursor);
    const page = await this.getJson<{ servers: RegistryServerResponse[]; metadata?: { nextCursor?: string } }>(`/servers?${params}`);
    return {
      servers: page.servers.filter(isActive).map((s) => s.server),
      nextCursor: page.metadata?.nextCursor || undefined,
    };
  }

  async get(name: string, version = 'latest'): Promise<RegistryServer> {
    const res = await this.getJson<RegistryServerResponse>(`/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
    return res.server;
  }
}
