import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, FileCode, FileJson, FolderSearch, Globe, History, Lock, Monitor, Moon, Network, Pencil, Plus, RefreshCw, Sun, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BUILT_IN_PATTERNS, hostOf, matchHost, normalizePattern, patternError, SINGLE_LABEL_RULE } from '@shared/private-network';
import type { RegistryInfo } from '@shared/registry';
import type { Settings as SettingsData, ThemeSetting, UpdateChannel } from '@shared/api';
import type { SecretsMode } from '@shared/types';
import { ClientMark } from '../components/bits';
import { RegistryDialog } from '../components/RegistryDialog';
import { useCheckForUpdates } from '../components/Updates';
import { Badge, Button, cx, Input, PageHeader, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useRecheckRuntimes, useRecheckRuntimesOnFocus, useRegistries, useRuntimes } from '../lib/hooks';

function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const isUrl = (location: string) => /^https?:\/\//i.test(location);

function Registries() {
  const queryClient = useQueryClient();
  const registries = useRegistries();
  const [dialog, setDialog] = useState<{ registry?: RegistryInfo } | null>(null);
  const refresh = () => {
    for (const key of ['registries', 'catalog', 'server']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.registriesUpdate(id, { enabled }),
    // Flip the checkbox right away; the refetch puts it back if saving failed.
    onMutate: ({ id, enabled }) => queryClient.setQueryData<RegistryInfo[]>(['registries'], (list) => list?.map((r) => (r.id === id ? { ...r, enabled } : r))),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: api.registriesRemove, onSuccess: refresh });
  const reload = useMutation({ mutationFn: api.registriesRefresh, onSuccess: refresh });
  const reloadError = reload.error && `${registries.data?.find((r) => r.id === reload.variables)?.name ?? 'Registry'}: ${errorMessage(reload.error)}`;

  return (
    <Section title="Registries" description="Where Kumi looks for MCP servers. Discover searches every registry that's turned on.">
      {registries.isLoading && <Spinner />}
      <ul className="divide-y divide-line">
        {registries.data?.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2.5">
            {r.kind === 'api' ? <Globe className="size-4 shrink-0 text-muted" /> : <FileJson className="size-4 shrink-0 text-muted" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{r.name}</span>
                {r.builtIn && <Badge tone="accent">built in</Badge>}
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
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={r.enabled}
                disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })}
              />
              On
            </label>
            {/* A local file is already read again whenever it changes. */}
            {(r.kind === 'api' || isUrl(r.location)) && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="size-3.5" />}
                title={r.enabled ? 'Fetch this registry again now instead of using the copy cached in the last ten minutes' : 'Turn this registry on to refresh it'}
                loading={reload.isPending && reload.variables === r.id}
                disabled={!r.enabled || reload.isPending}
                onClick={() => reload.mutate(r.id)}
              >
                Refresh
              </Button>
            )}
            {!r.builtIn && (
              <>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setDialog({ registry: r })}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-3.5" />}
                  loading={remove.isPending && remove.variables === r.id}
                  onClick={() =>
                    window.confirm(`Remove "${r.name}"? Servers you installed from it stay installed, but you won't be able to edit them with a form until you add it again.`) &&
                    remove.mutate(r.id)
                  }
                >
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button icon={<Plus className="size-4" />} onClick={() => setDialog({})}>
          Add registry
        </Button>
      </div>
      {(toggle.error || remove.error) && <p className="mt-2 text-xs text-danger">{errorMessage(toggle.error ?? remove.error)}</p>}
      {reloadError && <p className="mt-2 text-xs text-danger">{reloadError}</p>}
      {dialog && <RegistryDialog registry={dialog.registry} onClose={() => setDialog(null)} />}
    </Section>
  );
}

/** What the "Check a URL" box says about what was typed. */
function checkUrl(text: string, settings: SettingsData): string {
  const host = hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (!host) return 'Not a valid URL or host name.';
  const m = matchHost(host, settings);
  if (!m) return `${host} doesn't match any pattern. Kumi treats it as a public host.`;
  return `${host} matches ${m.pattern}${m.source === 'built-in' ? ' (built in)' : ''}${m.vpn ? `: connect to ${m.vpn}` : ''}.`;
}

function PrivateNetworks({ settings, save }: { settings?: SettingsData; save: (patch: Partial<SettingsData>) => void }) {
  const patterns = settings?.privateNetworks ?? [];
  const [pattern, setPattern] = useState('');
  const [vpn, setVpn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState('');

  const add = () => {
    const problem = patternError(pattern);
    if (problem) return setError(problem);
    const p = normalizePattern(pattern);
    if (patterns.some((x) => x.pattern === p)) return setError(`${p} is already in the list.`);
    save({ privateNetworks: [...patterns, { pattern: p, ...(vpn.trim() ? { vpn: vpn.trim() } : {}) }] });
    setPattern('');
    setVpn('');
    setError(null);
  };

  return (
    <Section
      title="Private networks"
      description="Hosts that are only reachable on a VPN or office network. Kumi marks servers on them, and says so when a test can't reach one."
    >
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-accent"
          checked={settings?.privateNetworkBuiltIns ?? true}
          onChange={(e) => save({ privateNetworkBuiltIns: e.target.checked })}
        />
        <span>
          Include names and ranges that can only be private
          <span className="mt-1 flex flex-wrap gap-1">
            {[SINGLE_LABEL_RULE, ...BUILT_IN_PATTERNS].map((p) => (
              <code key={p} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {p}
              </code>
            ))}
          </span>
        </span>
      </label>

      {patterns.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {patterns.map((p) => (
            <li key={p.pattern} className="flex items-center gap-3 py-2">
              <Network className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{p.pattern}</span>
              <span className="min-w-0 truncate text-xs text-muted">{p.vpn ?? 'no VPN name'}</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => save({ privateNetworks: patterns.filter((x) => x.pattern !== p.pattern) })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            setError(null);
          }}
          placeholder="*.acme.com or 10.42.0.0/16"
          className="max-w-72 font-mono"
          aria-label="Host pattern"
        />
        <Input value={vpn} onChange={(e) => setVpn(e.target.value)} placeholder="VPN name (optional)" className="max-w-56" aria-label="VPN name" maxLength={100} />
        <Button type="submit" icon={<Plus className="size-4" />} disabled={!pattern.trim()}>
          Add
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        A pattern is a host (<code className="font-mono">mcp.acme.com</code>), every host under a domain (<code className="font-mono">*.acme.com</code>), or an IP
        address or range (<code className="font-mono">10.42.0.0/16</code>). The VPN name is used in messages: "connect to Acme GlobalProtect".
      </p>

      <label className="mt-4 block space-y-1">
        <span className="block text-[13px] font-medium">Check a URL</span>
        <Input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="https://mcp.acme.com/mcp" className="max-w-md font-mono" />
      </label>
      {check.trim() && settings && <p className="mt-1.5 text-xs text-muted">{checkUrl(check.trim(), settings)}</p>}
    </Section>
  );
}

const THEMES: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
];

/** A segmented control: one button per theme, the current one raised. */
function ThemePicker({ value, onChange }: { value: ThemeSetting; onChange: (theme: ThemeSetting) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-xl border border-line bg-sunken p-1">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
            value === t.value ? 'bg-panel text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settingsGet });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clientsList });
  const runtimes = useRuntimes();
  const recheckRuntimes = useRecheckRuntimes();
  useRecheckRuntimesOnFocus(!!runtimes.data?.some((r) => !r.path));
  const backups = useQuery({ queryKey: ['backups'], queryFn: api.backupsList });

  const save = useMutation({
    mutationFn: api.settingsSet,
    // Show the choice right away; the theme itself switches once the main process has saved it.
    onMutate: (patch) => queryClient.setQueryData<SettingsData>(['settings'], (s) => (s ? { ...s, ...patch } : s)),
    onSuccess: (s) => queryClient.setQueryData(['settings'], s),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const checkUpdates = useCheckForUpdates();
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

      <Section title="Appearance" description="System follows your computer's light or dark mode.">
        <ThemePicker value={settings.data?.theme ?? 'system'} onChange={(theme) => save.mutate({ theme })} />
      </Section>

      <Registries />

      <PrivateNetworks settings={settings.data} save={(patch) => save.mutate(patch)} />

      <Section title="Secrets" description="Default for new installs. You can change it per install.">
        <Select
          value={settings.data?.defaultSecretsMode ?? 'inline'}
          onChange={(e) => save.mutate({ defaultSecretsMode: e.target.value as SecretsMode })}
          className="max-w-md"
        >
          <option value="inline">Write secrets into config files (works everywhere)</option>
          <option value="client-native">Use the app's secure storage where available (VS Code)</option>
        </Select>
        {save.error && <p className="mt-2 text-xs text-danger">{errorMessage(save.error)}</p>}
      </Section>

      <Section title="Updates" description="Kumi asks GitHub for new releases when it starts and every few hours.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={settings.data?.autoCheckUpdates ?? true}
            onChange={(e) => save.mutate({ autoCheckUpdates: e.target.checked })}
          />
          Check for updates automatically
        </label>
        <p className="mt-1 ml-6 text-xs text-muted">When this is off, Kumi still checks, but only tells you about important and required updates.</p>
        <Select
          value={settings.data?.updateChannel ?? 'stable'}
          // Look again right away, so the banner and About match the new channel.
          onChange={(e) => save.mutate({ updateChannel: e.target.value as UpdateChannel }, { onSuccess: () => checkUpdates.mutate() })}
          className="mt-3 max-w-md"
          aria-label="Update channel"
        >
          <option value="stable">Stable releases</option>
          <option value="prerelease">Stable releases and release candidates</option>
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

      <Section
        title="Runtimes"
        description="Programs that local MCP servers need."
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-3.5" />}
            loading={recheckRuntimes.isPending}
            onClick={() => recheckRuntimes.mutate()}
            title="Check again"
            aria-label="Check runtimes again"
          />
        }
      >
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
