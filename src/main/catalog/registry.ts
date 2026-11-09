// Client for any registry that implements the MCP Registry API, such as the official one.

import type { RegistryServer, RegistryServerResponse } from '@shared/registry';
import type { HttpCache } from './http';

export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0.1';

export interface SourcePage {
  servers: RegistryServer[];
  nextCursor?: string;
}

/** One source of servers: an API registry or a static file. */
export interface RegistrySource {
  search(query: string, cursor?: string, limit?: number): Promise<SourcePage>;
  get(name: string, version?: string): Promise<RegistryServer>;
}

export function isActive(r: RegistryServerResponse): boolean {
  const meta = r._meta?.['io.modelcontextprotocol.registry/official'] as { status?: string } | undefined;
  return !meta?.status || meta.status === 'active';
}

const NOT_FOUND = 'Not found';

type ListResponse ={ servers: RegistryServerResponse[]; metadata?: { nextCursor?: string } };

export class ApiRegistry implements RegistrySource {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpCache,
    baseUrl: string,
    private readonly token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private getJson<T>(path: string): Promise<T> {
    return this.http.getJson<T>(`${this.baseUrl}${path}`, { token: this.token, notFound: 'Not found in the registry' });
  }

  async search(query: string, cursor?: string, limit = 30): Promise<SourcePage> {
    const params = new URLSearchParams({ limit: String(limit), version: 'latest' });
    if (query.trim()) params.set('search', query.trim());
    if (cursor) params.set('cursor', cursor);
    const page = await this.getJson<ListResponse>(`/servers?${params}`);
    return {
      servers: page.servers.filter(isActive).map((s) => s.server),
      nextCursor: page.metadata?.nextCursor || undefined,
    };
  }

  async get(name: string, version = 'latest'): Promise<RegistryServer> {
    const res = await this.getJson<RegistryServerResponse>(`/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
    return res.server;
  }

  /**
   * Checks that a URL answers like an MCP Registry and returns the base URL to save.
   * People often paste the bare host, so the versioned paths are tried too.
   */
  static async probe(http: HttpCache, url: string, token?: string): Promise<string> {
    const base = url.replace(/\/+$/, '');
    const candidates = /\/v\d+(\.\d+)?$/.test(base) ? [base] : [base, `${base}/v0.1`, `${base}/v0`];
    for (const candidate of candidates) {
      let page: Partial<ListResponse>;
      try {
        page = await http.getJson<Partial<ListResponse>>(`${candidate}/servers?limit=1`, { token, noCache: true, notFound: NOT_FOUND });
      } catch (e) {
        // A 404 means "wrong path", so try the next one; anything else won't get better.
        if (e instanceof Error && e.message === NOT_FOUND) continue;
        throw e;
      }
      if (Array.isArray(page?.servers)) return candidate;
      throw new Error('The URL answered, but not like an MCP Registry (no "servers" list).');
    }
    throw new Error(`No MCP Registry API found at ${base}. Tried ${candidates.map((c) => `${c}/servers`).join(', ')}.`);
  }
}
