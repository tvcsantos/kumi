// Searches every enabled registry at once and pages through them together.

import type { CatalogItem, CatalogPage, RegistryDraft, RegistryInfo, RegistryPatch, RegistryServer } from '@shared/registry';
import { FileRegistry } from './file';
import type { HttpCache } from './http';
import { ApiRegistry, type RegistrySource } from './registry';
import type { RegistryStore, ResolvedRegistry } from './sources';

/** Per-registry cursors; `null` means "first page". Registries that ran out are left out. */
type MergedCursor = Record<string, string | null>;

function encodeCursor(c: MergedCursor): string | undefined {
  return Object.keys(c).length ? Buffer.from(JSON.stringify(c)).toString('base64url') : undefined;
}

function decodeCursor(cursor: string): MergedCursor {
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (c && typeof c === 'object' && !Array.isArray(c)) return c as MergedCursor;
  } catch {
    // fall through
  }
  throw new Error('Invalid cursor');
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Catalog {
  private sources = new Map<string, { key: string; source: RegistrySource }>();

  constructor(
    private readonly store: RegistryStore,
    private readonly http: HttpCache,
  ) {}

  private sourceFor(r: ResolvedRegistry): RegistrySource {
    const key = [r.kind, r.location, r.token ?? ''].join('\n');
    const hit = this.sources.get(r.id);
    if (hit?.key === key) return hit.source;
    const source = r.kind === 'api' ? new ApiRegistry(this.http, r.location, r.token) : new FileRegistry(this.http, r.location, r.token);
    this.sources.set(r.id, { key, source });
    return source;
  }

  /** Searches one registry, or every enabled one when `registryId` is omitted. */
  async search(query: string, cursor?: string, registryId?: string): Promise<CatalogPage> {
    const enabled = (await this.store.list()).filter((r) => r.enabled && (!registryId || r.id === registryId));
    const state: MergedCursor = cursor ? decodeCursor(cursor) : Object.fromEntries(enabled.map((r) => [r.id, null]));
    // Registries the user added come first: they're smaller and more specific, and would otherwise sit below a full page of official results.
    const targets = enabled.filter((r) => r.id in state).sort((a, b) => Number(a.builtIn) - Number(b.builtIn));

    const results = await Promise.allSettled(
      targets.map(async (info) => {
        const r = (await this.store.resolve(info.id))!;
        return this.sourceFor(r).search(query, state[info.id] ?? undefined);
      }),
    );

    const items: CatalogItem[] = [];
    const next: MergedCursor = {};
    const failures: { registryId: string; error: string }[] = [];
    results.forEach((res, i) => {
      const id = targets[i].id;
      if (res.status === 'rejected') {
        failures.push({ registryId: id, error: message(res.reason) });
        return;
      }
      for (const server of res.value.servers) items.push({ registryId: id, server });
      if (res.value.nextCursor) next[id] = res.value.nextCursor;
    });

    if (targets.length > 0 && failures.length === targets.length) {
      if (failures.length === 1) throw new Error(failures[0].error);
      throw new Error(failures.map((f) => `${targets.find((t) => t.id === f.registryId)!.name}: ${f.error}`).join('; '));
    }
    return { items, nextCursor: encodeCursor(next), ...(failures.length ? { failures } : {}) };
  }

  /** Works for disabled registries too, so servers installed from one can still be edited. */
  async get(registryId: string, name: string, version?: string): Promise<RegistryServer> {
    const r = await this.store.resolve(registryId);
    if (!r) throw new Error('The registry this server came from is no longer configured. Add it again in Settings.');
    return this.sourceFor(r).get(name, version);
  }

  list(): Promise<RegistryInfo[]> {
    return this.store.list();
  }

  /** Checks the registry answers before saving it. API URLs may be rewritten to the versioned base URL. */
  private async check(kind: RegistryDraft['kind'], location: string, token?: string): Promise<string> {
    if (kind === 'api') return ApiRegistry.probe(this.http, location, token);
    await new FileRegistry(this.http, location, token).probe();
    return location;
  }

  async add(draft: RegistryDraft): Promise<RegistryInfo> {
    const location = await this.check(draft.kind, draft.location.trim(), draft.token || undefined);
    return this.store.add({ ...draft, location });
  }

  async update(id: string, patch: RegistryPatch): Promise<RegistryInfo> {
    const current = await this.store.resolve(id);
    if (!current) throw new Error('Registry not found');
    const changesSource = patch.kind !== undefined || patch.location !== undefined || patch.token !== undefined;
    if (!current.builtIn && changesSource) {
      const kind = patch.kind ?? current.kind;
      const token = patch.token === undefined ? current.token : patch.token || undefined;
      patch = { ...patch, location: await this.check(kind, (patch.location ?? current.location).trim(), token) };
    }
    return this.store.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.sources.delete(id);
  }
}
