import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, FileCode, FolderSearch, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SecretsMode } from '@shared/types';
import { ClientMark } from '../components/bits';
import { Badge, Button, Input, PageHeader, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settingsGet });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clientsList });
  const runtimes = useQuery({ queryKey: ['runtimes'], queryFn: api.runtimesCheck });
  const backups = useQuery({ queryKey: ['backups'], queryFn: api.backupsList });
  const [registryUrl, setRegistryUrl] = useState('');

  useEffect(() => {
    if (settings.data) setRegistryUrl(settings.data.registryUrl);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: api.settingsSet,
    onSuccess: (s) => {
      queryClient.setQueryData(['settings'], s);
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['server'] });
    },
  });
  const restore = useMutation({
    mutationFn: api.backupsRestore,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />

      <Section title="Registry" description="Where Kumi looks for MCP servers. Any registry that implements the MCP Registry API works.">
        <div className="flex gap-2">
          <Input value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} className="font-mono" />
          <Button variant="primary" loading={save.isPending} disabled={registryUrl === settings.data?.registryUrl} onClick={() => save.mutate({ registryUrl })}>
            Save
          </Button>
        </div>
        {save.error && <p className="mt-2 text-xs text-danger">{errorMessage(save.error)}</p>}
      </Section>

      <Section title="Secrets" description="Default for new installs. You can change it per install.">
        <Select
          value={settings.data?.defaultSecretsMode ?? 'inline'}
          onChange={(e) => save.mutate({ defaultSecretsMode: e.target.value as SecretsMode })}
          className="max-w-md"
        >
          <option value="inline">Write secrets into config files (works everywhere)</option>
          <option value="client-native">Use the app's secure storage where available (VS Code)</option>
        </Select>
      </Section>

      <Section title="Apps" description="Where each app keeps its MCP configuration on this machine.">
        {clients.isLoading && <Spinner />}
        <ul className="divide-y divide-line">
          {clients.data?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <ClientMark id={c.id} />
              <span className="w-44 font-medium">{c.displayName}</span>
              {c.detected ? <Badge tone="ok">detected</Badge> : <Badge>not detected</Badge>}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={c.userConfigPath}>
                {c.userConfigPath}
              </span>
              <Button size="sm" variant="ghost" icon={<FileCode className="size-3.5" />} onClick={() => api.openConfig(c.userConfigPath).catch((e) => window.alert(errorMessage(e)))}>
                Open
              </Button>
              <Button size="sm" variant="ghost" icon={<FolderSearch className="size-3.5" />} onClick={() => api.revealConfig(c.userConfigPath).catch((e) => window.alert(errorMessage(e)))}>
                Reveal
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Runtimes" description="Programs that local MCP servers need.">
        <ul className="space-y-2">
          {runtimes.data?.map((r) => (
            <li key={r.name} className="flex items-center gap-3 text-sm">
              {r.path ? <CheckCircle2 className="size-4 text-ok" /> : <CircleDashed className="size-4 text-muted" />}
              <span className="w-16 font-mono font-medium">{r.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{r.path ?? r.installHint}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Backups" description="Kumi copies each config file right before changing it. Restoring also backs up the current file first.">
        {backups.isLoading ? (
          <Spinner />
        ) : backups.data?.length ? (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {backups.data.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
                <ClientMark id={b.clientId} size={20} />
                <span className="w-40 text-xs text-muted">{new Date(b.createdAt).toLocaleString()}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={b.originalPath}>
                  {b.originalPath}
                  {!b.existed && <span className="text-muted"> (didn't exist)</span>}
                </span>
                <Button
                  size="sm"
                  icon={<History className="size-3.5" />}
                  loading={restore.isPending && restore.variables === b.id}
                  onClick={() => window.confirm(`Restore ${b.originalPath} to how it was on ${new Date(b.createdAt).toLocaleString()}?`) && restore.mutate(b.id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No backups yet.</p>
        )}
        {restore.error && <p className="mt-2 text-xs text-danger">{errorMessage(restore.error)}</p>}
      </Section>
    </div>
  );
}
