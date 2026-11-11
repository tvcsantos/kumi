import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { RegistryHeader, RegistryInfo, RegistryKind, RegistryPatch } from '@shared/registry';
import { api, errorMessage } from '../lib/api';
import { Button, Callout, Input, Modal, Select } from './ui';

const LOCATION_HELP: Record<RegistryKind, string> = {
  api: 'Base URL of a server that implements the MCP Registry API. If you paste just the host, Kumi finds the versioned path.',
  file: 'URL or absolute path of a JSON file: an array of server.json objects, or a registry response ({ "servers": [{ "server": … }] }).',
};

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {help && <span className="block text-xs text-muted">{help}</span>}
    </label>
  );
}

/** One row of the headers editor. `saved` is the header as it was saved; a saved secret's value is never sent here. */
interface HeaderRow {
  key: number;
  name: string;
  value: string;
  secret: boolean;
  saved?: RegistryHeader;
}

let nextKey = 0;
const newRow = (saved?: RegistryHeader): HeaderRow => ({ key: nextKey++, name: saved?.name ?? '', value: saved?.value ?? '', secret: saved?.secret ?? true, saved });

/** Whether an empty value keeps the saved secret: only while the row is still a secret under the same name. */
const keepsSaved = (r: HeaderRow) => r.secret && !!r.saved?.secret && r.name.trim().toLowerCase() === r.saved.name.toLowerCase();

const toHeader = (r: HeaderRow): RegistryHeader => ({ name: r.name.trim(), secret: r.secret, ...(r.value || !keepsSaved(r) ? { value: r.value } : {}) });

const savedHeader = (h: RegistryHeader): RegistryHeader => ({ name: h.name, secret: h.secret, ...(h.secret ? {} : { value: h.value }) });

/** Adds a registry, or edits one when `registry` is given. Kumi checks the registry answers before saving. */
export function RegistryDialog({ registry, onClose }: { registry?: RegistryInfo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(registry?.name ?? '');
  const [kind, setKind] = useState<RegistryKind>(registry?.kind ?? 'api');
  const [location, setLocation] = useState(registry?.location ?? '');
  const [headers, setHeaders] = useState<HeaderRow[]>(() => (registry?.headers ?? []).map((h) => newRow(h)));

  const setRow = (key: number, change: Partial<HeaderRow>) => setHeaders((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  // New rows left completely empty are ignored; a half-filled one blocks saving.
  const active = headers.filter((r) => r.saved || r.name.trim() || r.value);
  const incomplete = active.some((r) => !r.name.trim() || (!r.value && !keepsSaved(r)));

  const save = useMutation({
    mutationFn: () => {
      const list = active.map(toHeader);
      if (!registry) {
        return api.registriesAdd({ name, kind, location, ...(list.length ? { headers: list } : {}) });
      }
      const patch: RegistryPatch = {};
      if (name !== registry.name) patch.name = name;
      if (kind !== registry.kind) patch.kind = kind;
      if (location !== registry.location) patch.location = location;
      if (JSON.stringify(list) !== JSON.stringify(registry.headers.map(savedHeader))) patch.headers = list;
      return api.registriesUpdate(registry.id, patch);
    },
    onSuccess: () => {
      for (const key of ['registries', 'catalog', 'server']) void queryClient.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });

  const pickFile = async () => {
    const path = await api.pickFile();
    if (path) setLocation(path);
  };

  return (
    <Modal
      title={registry ? `Edit ${registry.name}` : 'Add a registry'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !location.trim() || incomplete} onClick={() => save.mutate()}>
            {registry ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && location.trim() && !incomplete) save.mutate();
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme internal" maxLength={60} />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as RegistryKind)}>
            <option value="api">MCP Registry API</option>
            <option value="file">Static JSON file</option>
          </Select>
        </Field>
        <Field label={kind === 'api' ? 'URL' : 'URL or file'} help={LOCATION_HELP[kind]}>
          <div className="flex gap-2">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={kind === 'api' ? 'https://registry.example.com/v0.1' : 'https://example.com/servers.json'}
              className="font-mono"
            />
            {kind === 'file' && (
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void pickFile()}>
                Choose…
              </Button>
            )}
          </div>
        </Field>
        <div className="space-y-1">
          <span className="text-sm font-medium">Headers (optional)</span>
          {headers.map((r) => (
            <div key={r.key} className="flex gap-2">
              <Input
                aria-label="Header name"
                value={r.name}
                onChange={(e) => setRow(r.key, { name: e.target.value })}
                placeholder="Authorization"
                className="min-w-0 basis-1/3 font-mono"
              />
              <Input
                aria-label={r.name ? `${r.name} value` : 'Header value'}
                type={r.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={r.value}
                onChange={(e) => setRow(r.key, { value: e.target.value })}
                placeholder={keepsSaved(r) ? 'Keep saved value' : r.saved?.secret ? 'Enter a new value' : 'Bearer …'}
                className="min-w-0 flex-1 font-mono"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Secret values are stored encrypted and hidden once saved">
                <input type="checkbox" className="size-4 accent-accent" checked={r.secret} onChange={(e) => setRow(r.key, { secret: e.target.checked })} />
                Secret
              </label>
              <Button
                variant="ghost"
                aria-label={r.name ? `Remove the ${r.name} header` : 'Remove this header'}
                icon={<X className="size-4" />}
                onClick={() => setHeaders((rows) => rows.filter((x) => x.key !== r.key))}
              />
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setHeaders((rows) => [...rows, newRow()])}>
            Add header
          </Button>
          <span className="block text-xs text-muted">
            Sent with every request to this registry, e.g. <code>Authorization: Bearer …</code> or an API key. Secret values are stored encrypted with your OS keychain, hidden once saved (leave one empty to keep it), and only sent over https.
          </span>
        </div>
        {save.isPending && <p className="text-xs text-muted">Checking the registry…</p>}
        {save.error && <Callout tone="danger">{errorMessage(save.error)}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
