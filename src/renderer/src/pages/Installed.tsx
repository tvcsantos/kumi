import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, FileCode, FolderPlus, Layers, Pencil, PlugZap, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { HealthResult, InstalledEntry, InstallTarget, ServerSpec } from '@shared/types';
import { ClientMark, scopeLabel } from '../components/bits';
import { HealthPanel, type WizardSource } from '../components/InstallWizard';
import { Badge, Button, Callout, Empty, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { OFFICIAL_REGISTRY_ID } from '@shared/registry';
import { useInstalled, useRegistries } from '../lib/hooks';

interface Group {
  name: string;
  entries: InstalledEntry[];
}

function groupEntries(entries: InstalledEntry[]): Group[] {
  const map = new Map<string, InstalledEntry[]>();
  for (const e of entries) map.set(e.name, [...(map.get(e.name) ?? []), e]);
  return [...map.entries()].map(([name, list]) => ({ name, entries: list })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The entry whose spec best represents the server: not bridged, not using VS Code input placeholders. */
function representative(entries: InstalledEntry[]): InstalledEntry {
  const clean = (e: InstalledEntry) => !e.spec.args?.includes('mcp-remote') && !JSON.stringify(e.spec).includes('${input:') && e.spec.command !== 'cmd';
  return entries.find(clean) ?? entries[0];
}

function describeSpec(spec: ServerSpec): string {
  return spec.transport === 'stdio' ? [spec.command, ...(spec.args ?? [])].join(' ') : spec.url ?? '';
}

function GroupRow({ group, onEdit }: { group: Group; onEdit: (source: WizardSource) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rep = representative(group.entries);
  const managed = group.entries.filter((e) => e.record);
  const source = managed.find((e) => e.record?.source)?.record?.source;
  const registries = useRegistries();
  const fromRegistry = source && source.registryId !== OFFICIAL_REGISTRY_ID ? registries.data?.find((r) => r.id === source.registryId) : undefined;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['installed'] });
    void queryClient.invalidateQueries({ queryKey: ['backups'] });
  };

  const test = useMutation({ mutationFn: () => api.healthTest(rep.spec), onSuccess: setHealth, onError: (e) => setError(errorMessage(e)) });

  const uninstall = useMutation({
    mutationFn: async (entries: InstalledEntry[]) => {
      const foreign = entries.filter((e) => !e.record);
      if (foreign.length && !window.confirm(`"${group.name}" wasn't installed by Kumi in ${foreign.length} place(s). Remove it anyway? A backup is kept.`)) return;
      for (const e of entries) {
        const r = await api.uninstall({ clientId: e.clientId, scope: e.scope, name: e.name }, !e.record);
        if (!r.ok) throw new Error(r.error);
      }
    },
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });

  const edit = useMutation({
    mutationFn: async () => {
      const targets: InstallTarget[] = group.entries.map((e) => ({ clientId: e.clientId, scope: e.scope }));
      const rec = managed.find((e) => e.record?.source?.variant.kind !== 'custom' && e.record?.source)?.record;
      if (rec?.source && rec.source.variant.kind !== 'custom') {
        const { registryId } = rec.source;
        const [server, values] = await Promise.all([api.catalogGet(registryId, rec.source.registryName, rec.source.version), api.installedValues(rec.id)]);
        onEdit({
          kind: 'registry',
          registryId,
          server,
          edit: { name: group.name, variantRef: rec.source.variant, values, targets, secretsMode: rec.secretsMode },
        });
      } else {
        onEdit({ kind: 'custom', spec: rep.spec, targets, edit: true });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{group.name}</span>
              {managed.length === 0 ? <Badge>added manually</Badge> : managed.length < group.entries.length ? <Badge tone="warn">partly managed</Badge> : null}
            </div>
            <div className="truncate font-mono text-[11px] text-muted">
              {source?.registryName ?? describeSpec(rep.spec)}
              {fromRegistry && <span className="font-sans"> · {fromRegistry.name}</span>}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 -space-x-1">
          {[...new Set(group.entries.map((e) => e.clientId))].map((id) => (
            <ClientMark key={id} id={id} />
          ))}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" icon={<PlugZap className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()} title="Test connection">
            Test
          </Button>
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} loading={edit.isPending} onClick={() => edit.mutate()}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            loading={uninstall.isPending}
            onClick={() => window.confirm(`Remove "${group.name}" from ${group.entries.length} app config(s)?`) && uninstall.mutate(group.entries)}
          >
            Remove
          </Button>
        </div>
      </div>

      {(health || error || test.isPending) && (
        <div className="space-y-2 px-4 pb-3">
          {test.isPending && <Spinner label="Starting the server…" />}
          {health && <HealthPanel result={health} />}
          {error && (
            <Callout tone="danger">
              <div className="flex items-start justify-between gap-2">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
                  <X className="size-4" />
                </button>
              </div>
            </Callout>
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-line">
          {group.entries.map((e) => (
            <div key={`${e.clientId}|${e.configPath}|${e.scope.kind}|${e.scope.projectDir ?? ''}`} className="flex items-center gap-3 px-4 py-2.5 text-sm odd:bg-sunken/40">
              <ClientMark id={e.clientId} size={20} />
              <Badge>{scopeLabel(e.scope)}</Badge>
              {e.record ? <Badge tone="ok">managed</Badge> : <Badge>manual</Badge>}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={describeSpec(e.spec)}>
                {describeSpec(e.spec)}
              </span>
              <Button size="sm" variant="ghost" icon={<FileCode className="size-3.5" />} onClick={() => api.openConfig(e.configPath)} title={e.configPath}>
                Config
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => window.confirm(`Remove "${e.name}" from this config?`) && uninstall.mutate([e])}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Installed({ onEdit, onAddCustom }: { onEdit: (source: WizardSource) => void; onAddCustom: () => void }) {
  const queryClient = useQueryClient();
  const installed = useInstalled();
  const groups = groupEntries(installed.data?.entries ?? []);

  const addProject = useMutation({
    mutationFn: async () => {
      const dir = await api.pickDirectory();
      if (dir) await api.projectsAdd(dir);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['installed'] }),
  });
  const removeProject = useMutation({
    mutationFn: (dir: string) => api.projectsRemove(dir),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['installed'] }),
  });

  return (
    <div>
      <PageHeader
        title="Installed"
        subtitle="Every MCP server configured in your apps, including ones you added by hand."
        actions={
          <>
            <Button icon={<RefreshCw className="size-4" />} loading={installed.isFetching} onClick={() => installed.refetch()}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={onAddCustom}>
              Custom server
            </Button>
          </>
        }
      />

      {installed.data?.errors.map((err) => (
        <div key={err.configPath} className="mb-3">
          <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
            <div className="flex items-center justify-between gap-3">
              <span>
                Couldn't read <span className="font-mono">{err.configPath}</span>: {err.error}. Kumi won't touch this file until it's fixed.
              </span>
              <Button size="sm" onClick={() => api.openConfig(err.configPath)}>
                Open
              </Button>
            </div>
          </Callout>
        </div>
      ))}

      {installed.isLoading ? (
        <Spinner label="Reading app configs…" />
      ) : groups.length === 0 ? (
        <Empty icon={<Layers className="size-8" />} title="No MCP servers yet">
          Install one from Discover, or add a custom server.
        </Empty>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <GroupRow key={g.name} group={g} onEdit={onEdit} />
          ))}
        </div>
      )}

      <section className="mt-10">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Project folders</h2>
            <p className="text-xs text-muted">Kumi also reads project-level configs (.mcp.json, .vscode/mcp.json, .cursor/mcp.json) in these folders.</p>
          </div>
          <Button size="sm" icon={<FolderPlus className="size-3.5" />} onClick={() => addProject.mutate()}>
            Add folder
          </Button>
        </div>
        {installed.data?.projects.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {installed.data.projects.map((p) => (
              <li key={p} className="flex items-center justify-between px-3 py-2 font-mono text-xs">
                {p}
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => removeProject.mutate(p)} aria-label={`Stop tracking ${p}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No project folders yet.</p>
        )}
        {addProject.error && <p className="mt-2 text-xs text-danger">{errorMessage(addProject.error)}</p>}
      </section>
    </div>
  );
}
