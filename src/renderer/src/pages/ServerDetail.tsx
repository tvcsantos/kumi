import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Code2, Download, ExternalLink, KeyRound, Lock } from 'lucide-react';
import type { RegistryServer } from '@shared/registry';
import { getVariants } from '@shared/variants';
import { ClientMark, displayName, scopeLabel, ServerIcon } from '../components/bits';
import { Badge, Button, Callout, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useInstalledByServer } from '../lib/hooks';

export function ServerDetail({ initial, onBack, onInstall }: { initial: RegistryServer; onBack: () => void; onInstall: (server: RegistryServer) => void }) {
  const full = useQuery({ queryKey: ['server', initial.name], queryFn: () => api.catalogGet(initial.name) });
  const server = full.data ?? initial;
  const variants = getVariants(server);
  const installed = useInstalledByServer(server.name);
  const installable = variants.some((v) => !v.unsupported);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
        Back
      </Button>

      <header className="flex items-start gap-4">
        <ServerIcon server={server} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{displayName(server)}</h1>
          <div className="mt-0.5 font-mono text-xs text-muted">
            {server.name} · v{server.version}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {server.repository?.url && (
              <Button size="sm" icon={<Code2 className="size-3.5" />} onClick={() => api.openExternal(server.repository!.url!)}>
                Source
              </Button>
            )}
            {server.websiteUrl && (
              <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openExternal(server.websiteUrl!)}>
                Website
              </Button>
            )}
          </div>
        </div>
        <Button variant="primary" icon={<Download className="size-4" />} disabled={!installable} onClick={() => onInstall(server)}>
          {installed.length ? 'Install again' : 'Install'}
        </Button>
      </header>

      {full.error && <Callout tone="warn">Showing cached details: {errorMessage(full.error)}</Callout>}
      {full.isLoading && <Spinner label="Loading details…" />}

      <p className="max-w-3xl text-[15px] leading-relaxed">{server.description}</p>

      {installed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Installed in</h2>
          <div className="flex flex-wrap gap-2">
            {installed.map((e) => (
              <span key={`${e.clientId}-${e.configPath}-${e.scope.kind}`} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1 text-xs">
                <ClientMark id={e.clientId} size={18} /> {scopeLabel(e.scope)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Ways to run it</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {variants.map((v) => (
            <div key={`${v.ref.kind}-${v.ref.index}`} className="rounded-2xl border border-line bg-panel p-4">
              <div className="truncate font-mono text-[13px]">{v.label}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge>{v.ref.kind === 'remote' ? 'hosted' : 'runs locally'}</Badge>
                <Badge>{v.transport}</Badge>
                {v.runtime && <Badge>needs {v.runtime}</Badge>}
                {v.unsupported && <Badge tone="warn">not supported</Badge>}
              </div>
              {v.unsupported ? (
                <p className="mt-3 text-xs text-muted">{v.unsupported}</p>
              ) : v.fields.length ? (
                <ul className="mt-3 space-y-1.5">
                  {v.fields.map((f) => (
                    <li key={f.id} className="text-xs">
                      <span className="inline-flex items-center gap-1 font-mono font-medium">
                        {f.secret ? <Lock className="size-3 text-muted" /> : <KeyRound className="size-3 text-muted" />}
                        {f.label}
                        {f.required && <span className="text-spark">*</span>}
                      </span>
                      {f.description && <span className="text-muted"> · {f.description}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted">No settings needed.</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
