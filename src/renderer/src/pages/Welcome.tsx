// First-run screen: choose where Kumi looks for servers before showing the app.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileJson, Globe, Info, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Settings } from '@shared/api';
import type { RegistryInfo } from '@shared/registry';
import { AppIcon } from '../components/bits';
import { RegistryDialog } from '../components/RegistryDialog';
import { Badge, Button, Callout, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useRegistries } from '../lib/hooks';

function RegistryRow({ registry: r, onEdit, onRemove, removing }: { registry: RegistryInfo; onEdit: () => void; onRemove: () => void; removing: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {r.kind === 'api' ? <Globe className="size-4 shrink-0 text-muted" /> : <FileJson className="size-4 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          {r.kind === 'file' && <Badge>file</Badge>}
          {r.headers.length > 0 && (
            <Badge title={`Sends ${r.headers.map((h) => (h.secret ? `${h.name} (secret)` : h.name)).join(', ')}`}>
              {r.headers.some((h) => h.secret) && <Lock className="size-3" />} {r.headers.length === 1 ? '1 header' : `${r.headers.length} headers`}
            </Badge>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-muted" title={r.location}>
          {r.location}
        </div>
      </div>
      <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} icon={<Pencil className="size-3.5" />} onClick={onEdit} />
      <Button size="sm" variant="ghost" aria-label={`Remove ${r.name}`} icon={<Trash2 className="size-3.5" />} loading={removing} onClick={onRemove} />
    </li>
  );
}

export function Welcome() {
  const queryClient = useQueryClient();
  const registries = useRegistries();
  const [dialog, setDialog] = useState<{ registry?: RegistryInfo } | null>(null);

  const official = registries.data?.find((r) => r.builtIn);
  const added = registries.data?.filter((r) => !r.builtIn) ?? [];
  const refresh = () => {
    for (const key of ['registries', 'catalog']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const toggleOfficial = useMutation({
    mutationFn: (enabled: boolean) => api.registriesUpdate(official!.id, { enabled }),
    onSettled: refresh,
  });
  // Nothing has been installed yet, so removing needs no confirmation.
  const remove = useMutation({ mutationFn: api.registriesRemove, onSuccess: refresh });

  const finish = useMutation({
    mutationFn: async () => {
      // With no registries of its own, Kumi needs the official one.
      if (added.length === 0 && official && !official.enabled) await api.registriesUpdate(official.id, { enabled: true });
      return api.settingsSet({ setupDone: true });
    },
    onSuccess: (s: Settings) => {
      queryClient.setQueryData(['settings'], s);
      refresh();
    },
  });

  const error = toggleOfficial.error ?? remove.error ?? finish.error;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto w-full max-w-xl flex-1 px-6 pb-12">
        <div className="flex flex-col items-center text-center">
          <AppIcon size={64} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Welcome to Kumi
          </h1>
          <p className="mt-2 text-muted">
            Kumi finds MCP servers in registries and installs them into your apps. First, choose where it should look.
          </p>
        </div>

        <section className="mt-8 rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Your registries</h2>
          <p className="mt-0.5 text-sm text-muted">
            Add your company's registry, or a JSON file listing servers. Private registries can send headers such as a token.
          </p>

          {registries.isLoading ? (
            <div className="mt-4">
              <Spinner />
            </div>
          ) : added.length > 0 ? (
            <ul className="mt-3 divide-y divide-line">
              {added.map((r) => (
                <RegistryRow
                  key={r.id}
                  registry={r}
                  onEdit={() => setDialog({ registry: r })}
                  onRemove={() => remove.mutate(r.id)}
                  removing={remove.isPending && remove.variables === r.id}
                />
              ))}
            </ul>
          ) : (
            <div className="mt-4">
              <Callout tone="accent" icon={<Info className="size-4" />}>
                No registries added yet. Kumi will use the default, the <strong>{official?.name ?? 'Official MCP Registry'}</strong>
                {official && <span className="font-mono text-xs"> ({new URL(official.location).host})</span>}, which lists public MCP servers.
              </Callout>
            </div>
          )}

          <div className="mt-4">
            <Button icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
              Add a registry
            </Button>
          </div>

          {added.length > 0 && official && (
            <label className="mt-4 flex items-start gap-2.5 border-t border-line pt-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={official.enabled}
                disabled={toggleOfficial.isPending}
                onChange={(e) => toggleOfficial.mutate(e.target.checked)}
              />
              <span>
                <span className="font-medium">Also search the {official.name}</span>
                <span className="block text-xs text-muted">Public servers from {new URL(official.location).host}, alongside your own.</span>
              </span>
            </label>
          )}
        </section>

        {error && (
          <div className="mt-4">
            <Callout tone="danger">{errorMessage(error)}</Callout>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-muted">You can change this any time in Settings.</p>
          <Button variant="primary" loading={finish.isPending} disabled={registries.isLoading} onClick={() => finish.mutate()}>
            {added.length > 0 ? 'Continue' : 'Use the default registry'}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

      {dialog && (
        <RegistryDialog
          registry={dialog.registry}
          onClose={() => setDialog(null)}
          // Adding your own registry means you no longer rely on the official one, so it starts unticked.
          onAdded={() => {
            if (added.length === 0 && official?.enabled) toggleOfficial.mutate(false);
          }}
        />
      )}
    </div>
  );
}
