import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { Library, Search, Sparkles, TriangleAlert, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FEATURED } from '@shared/featured';
import { OFFICIAL_REGISTRY_ID, type CatalogItem, type RegistryInfo } from '@shared/registry';
import { ClientMark, displayName, ServerIcon } from '../components/bits';
import { Badge, Button, Callout, cx, Empty, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useInstalledByServer, useRegistries } from '../lib/hooks';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Short name for chips and badges. */
const registryLabel = (r: RegistryInfo) => (r.builtIn ? 'Official' : r.name);

function ServerCard({ item, onOpen, category, registry }: { item: CatalogItem; onOpen: () => void; category?: string; registry?: string }) {
  const { server } = item;
  const installed = useInstalledByServer(item.registryId, server.name);
  const local = !!server.packages?.length;
  const hosted = !!server.remotes?.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <ServerIcon server={server} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold group-hover:text-spark">{displayName(server)}</div>
          <div className="truncate font-mono text-[11px] text-muted">{server.name}</div>
        </div>
      </div>
      <p className="line-clamp-2 flex-1 text-[13px] text-muted">{server.description ?? 'No description.'}</p>
      <div className="flex flex-wrap items-center gap-1">
        {category && <Badge tone="accent">{category}</Badge>}
        {registry && (
          <Badge title={`From ${registry}`}>
            <Library className="size-3" /> {registry}
          </Badge>
        )}
        {local && <Badge>local</Badge>}
        {hosted && <Badge>hosted</Badge>}
        <Badge>v{server.version}</Badge>
        {installed.length > 0 && (
          <span className="ml-auto flex -space-x-1">
            {[...new Set(installed.map((e) => e.clientId))].map((id) => (
              <ClientMark key={id} id={id} size={18} />
            ))}
          </span>
        )}
      </div>
    </button>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">{children}</div>;
}

export function Discover({ onOpen }: { onOpen: (item: CatalogItem) => void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);
  const registries = useRegistries();
  const enabled = registries.data?.filter((r) => r.enabled) ?? [];
  const [filter, setFilter] = useState<string | undefined>();
  // Forget a filter whose registry was turned off or removed.
  const activeFilter = filter && enabled.some((r) => r.id === filter) ? filter : undefined;
  const officialOn = enabled.some((r) => r.id === OFFICIAL_REGISTRY_ID);
  const showFeatured = !q && officialOn && (!activeFilter || activeFilter === OFFICIAL_REGISTRY_ID);
  const nameOf = (id: string) => registries.data?.find((r) => r.id === id)?.name ?? 'a registry';
  // Badges only help when servers from several registries can show up together.
  const badgeFor = (id: string) => {
    if (enabled.length < 2) return undefined;
    const r = registries.data?.find((x) => x.id === id);
    return r && registryLabel(r);
  };

  // One query per featured server so cards appear as each arrives; the registry's tail latency is high.
  const featured = useQueries({
    queries: FEATURED.map((f) => ({
      queryKey: ['server', OFFICIAL_REGISTRY_ID, f.name],
      queryFn: () => api.catalogGet(OFFICIAL_REGISTRY_ID, f.name),
      staleTime: 10 * 60_000,
      enabled: showFeatured,
    })),
  });
  const featuredItems: CatalogItem[] = featured.flatMap((q) => (q.data ? [{ registryId: OFFICIAL_REGISTRY_ID, server: q.data }] : []));
  const featuredLoading = featured.some((q) => q.isLoading);
  const results = useInfiniteQuery({
    queryKey: ['catalog', activeFilter ?? 'all', q],
    queryFn: ({ pageParam }) => api.catalogSearch(q, pageParam, activeFilter),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled.length > 0,
  });
  const pages = results.data?.pages ?? [];
  const items = [...new Map(pages.flatMap((p) => p.items).map((i) => [`${i.registryId}\n${i.server.name}`, i])).values()];
  const failures = [...new Map(pages.flatMap((p) => p.failures ?? []).map((f) => [f.registryId, f])).values()];
  const categoryOf = (item: CatalogItem) => (item.registryId === OFFICIAL_REGISTRY_ID ? FEATURED.find((f) => f.name === item.server.name)?.category : undefined);
  const subtitle =
    enabled.length === 1 && officialOn
      ? 'MCP servers from the official MCP Registry. Pick one, fill in its settings, and install it into your apps.'
      : 'MCP servers from your registries. Pick one, fill in its settings, and install it into your apps.';

  if (registries.data && enabled.length === 0) {
    return (
      <div>
        <PageHeader title="Discover" />
        <Empty icon={<Library className="size-8" />} title="No registries are turned on">
          Turn on the official MCP Registry or add your own in Settings.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Discover" subtitle={subtitle} />
      <div className={cx('relative', enabled.length > 1 ? 'mb-4' : 'mb-6')}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers — github, postgres, browser…" className="h-11 pl-9 text-[15px]" />
      </div>
      {enabled.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5" role="group" aria-label="Registry">
          {[{ id: undefined, label: 'All' }, ...enabled.map((r) => ({ id: r.id, label: registryLabel(r) }))].map((chip) => (
            <button
              key={chip.id ?? 'all'}
              type="button"
              aria-pressed={activeFilter === chip.id}
              onClick={() => setFilter(chip.id)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                activeFilter === chip.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-panel text-muted hover:text-ink',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {showFeatured && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-spark" /> Featured
          </h2>
          <Grid>
            {featuredItems.map((item) => (
              <ServerCard key={item.server.name} item={item} category={categoryOf(item)} registry={badgeFor(item.registryId)} onOpen={() => onOpen(item)} />
            ))}
          </Grid>
          {featuredLoading && (
            <div className="mt-3">
              <Spinner label={featuredItems.length ? 'Loading more…' : 'Loading…'} />
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">{q ? `Results for “${q}”` : 'All servers'}</h2>
        {failures.length > 0 && !results.error && (
          <div className="mb-3">
            <Callout tone="warn" icon={<TriangleAlert className="size-4" />}>
              {failures.map((f) => (
                <div key={f.registryId}>
                  Couldn't search {nameOf(f.registryId)}: {f.error}
                </div>
              ))}
            </Callout>
          </div>
        )}
        {results.isLoading || registries.isLoading ? (
          <Spinner label={enabled.length > 1 ? 'Searching registries…' : 'Searching the registry…'} />
        ) : results.error ? (
          <Callout tone="danger" icon={<WifiOff className="size-4" />}>
            Couldn't reach {enabled.length > 1 && !activeFilter ? 'any registry' : 'the registry'}: {errorMessage(results.error)}
            <div className="mt-2">
              <Button size="sm" onClick={() => results.refetch()}>
                Try again
              </Button>
            </div>
          </Callout>
        ) : items.length === 0 ? (
          <Empty icon={<Search className="size-8" />} title="No servers found">
            Try a different search, or add a custom server from the Installed page.
          </Empty>
        ) : (
          <>
            <Grid>
              {items.map((item) => (
                <ServerCard
                  key={`${item.registryId}\n${item.server.name}`}
                  item={item}
                  category={categoryOf(item)}
                  registry={badgeFor(item.registryId)}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </Grid>
            {results.hasNextPage && (
              <div className="mt-6 flex justify-center">
                <Button loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
