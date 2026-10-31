import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { Search, Sparkles, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FEATURED } from '@shared/featured';
import type { RegistryServer } from '@shared/registry';
import { ClientMark, displayName, ServerIcon } from '../components/bits';
import { Badge, Button, Callout, Empty, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useInstalledByServer } from '../lib/hooks';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ServerCard({ server, onOpen, category }: { server: RegistryServer; onOpen: () => void; category?: string }) {
  const installed = useInstalledByServer(server.name);
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

export function Discover({ onOpen }: { onOpen: (server: RegistryServer) => void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);

  // One query per featured server so cards appear as each arrives; the registry's tail latency is high.
  const featured = useQueries({
    queries: FEATURED.map((f) => ({ queryKey: ['server', f.name], queryFn: () => api.catalogGet(f.name), staleTime: 10 * 60_000 })),
  });
  const featuredServers = featured.flatMap((q) => (q.data ? [q.data] : []));
  const featuredLoading = featured.some((q) => q.isLoading);
  const results = useInfiniteQuery({
    queryKey: ['catalog', q],
    queryFn: ({ pageParam }) => api.catalogSearch(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });
  const servers = [...new Map((results.data?.pages.flatMap((p) => p.servers) ?? []).map((s) => [s.name, s])).values()];
  const categoryOf = (name: string) => FEATURED.find((f) => f.name === name)?.category;

  return (
    <div>
      <PageHeader title="Discover" subtitle="MCP servers from the official MCP Registry. Pick one, fill in its settings, and install it into your apps." />
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers — github, postgres, browser…" className="h-11 pl-9 text-[15px]" />
      </div>

      {!q && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-spark" /> Featured
          </h2>
          <Grid>
            {featuredServers.map((s) => (
              <ServerCard key={s.name} server={s} category={categoryOf(s.name)} onOpen={() => onOpen(s)} />
            ))}
          </Grid>
          {featuredLoading && (
            <div className="mt-3">
              <Spinner label={featuredServers.length ? 'Loading more…' : 'Loading…'} />
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">{q ? `Results for “${q}”` : 'All servers'}</h2>
        {results.isLoading ? (
          <Spinner label="Searching the registry…" />
        ) : results.error ? (
          <Callout tone="danger" icon={<WifiOff className="size-4" />}>
            Couldn't reach the registry: {errorMessage(results.error)}
            <div className="mt-2">
              <Button size="sm" onClick={() => results.refetch()}>
                Try again
              </Button>
            </div>
          </Callout>
        ) : servers.length === 0 ? (
          <Empty icon={<Search className="size-8" />} title="No servers found">
            Try a different search, or add a custom server from the Installed page.
          </Empty>
        ) : (
          <>
            <Grid>
              {servers.map((s) => (
                <ServerCard key={s.name} server={s} category={categoryOf(s.name)} onOpen={() => onOpen(s)} />
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
