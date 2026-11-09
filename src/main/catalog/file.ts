// A registry kept as one static JSON file, at a URL or on disk. Search and paging happen here.

import { promises as fs } from 'node:fs';
import type { RegistryServer, RegistryServerResponse } from '@shared/registry';
import type { HttpCache } from './http';
import { isActive, type RegistrySource, type SourcePage } from './registry';

export const isUrl = (location: string) => /^https?:\/\//i.test(location);

/**
 * Accepts a plain array of `server.json` objects, or the registry's own list response
 * (`{ servers: [{ server, _meta }] }`). Entries without a name and version are skipped.
 */
export function parseServerList(data: unknown): RegistryServerResponse[] {
  const list = Array.isArray(data) ? data : (data as { servers?: unknown } | null)?.servers;
  if (!Array.isArray(list)) throw new Error('Expected a list of servers, or an object with a "servers" list.');
  const entries = list.map((el): RegistryServerResponse => (el && typeof el === 'object' && 'server' in el ? (el as RegistryServerResponse) : { server: el as RegistryServer }));
  const valid = entries.filter((r) => typeof r.server?.name === 'string' && typeof r.server?.version === 'string');
  if (list.length > 0 && valid.length === 0) throw new Error('None of the entries look like a server.json (each needs a "name" and a "version").');
  return valid;
}

function isLatest(r: RegistryServerResponse): boolean {
  const meta = r._meta?.['io.modelcontextprotocol.registry/official'] as { isLatest?: boolean } | undefined;
  return meta?.isLatest === true;
}

/** One entry per server name: the one flagged latest, otherwise the last one in the file. */
function latestByName(entries: RegistryServerResponse[]): RegistryServer[] {
  const byName = new Map<string, RegistryServerResponse>();
  for (const r of entries) {
    const prev = byName.get(r.server.name);
    if (!prev || !isLatest(prev) || isLatest(r)) byName.set(r.server.name, r);
  }
  return [...byName.values()].map((r) => r.server);
}

export class FileRegistry implements RegistrySource {
  private local: { mtimeMs: number; entries: RegistryServerResponse[] } | null = null;

  constructor(
    private readonly http: HttpCache,
    private readonly location: string,
    private readonly token?: string,
  ) {}

  private async entries(noCache = false): Promise<RegistryServerResponse[]> {
    if (isUrl(this.location)) {
      return parseServerList(await this.http.getJson<unknown>(this.location, { token: this.token, noCache, notFound: 'Registry file not found' }));
    }
    const { mtimeMs } = await fs.stat(this.location).catch((e: NodeJS.ErrnoException) => {
      throw new Error(e.code === 'ENOENT' ? `Registry file not found: ${this.location}` : e.message);
    });
    if (!this.local || this.local.mtimeMs !== mtimeMs) {
      let data: unknown;
      try {
        data = JSON.parse(await fs.readFile(this.location, 'utf8'));
      } catch (e) {
        throw new Error(`Couldn't read ${this.location}: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.local = { mtimeMs, entries: parseServerList(data) };
    }
    return this.local.entries;
  }

  async search(query: string, cursor?: string, limit = 30): Promise<SourcePage> {
    const q = query.trim().toLowerCase();
    const servers = latestByName((await this.entries()).filter(isActive)).filter(
      (s) => !q || [s.name, s.title, s.description].some((text) => text?.toLowerCase().includes(q)),
    );
    const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    const end = offset + limit;
    return { servers: servers.slice(offset, end), nextCursor: end < servers.length ? String(end) : undefined };
  }

  async get(name: string, version = 'latest'): Promise<RegistryServer> {
    const entries = (await this.entries()).filter((r) => r.server.name === name);
    const match = version === 'latest' ? latestByName(entries)[0] : entries.find((r) => r.server.version === version)?.server;
    if (!match) throw new Error('Not found in the registry');
    return match;
  }

  /** Loads the file once, bypassing caches, and returns how many servers it lists. */
  async probe(): Promise<number> {
    this.local = null;
    return latestByName(await this.entries(true)).length;
  }
}
