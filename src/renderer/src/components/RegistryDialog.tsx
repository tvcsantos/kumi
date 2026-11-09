import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { RegistryInfo, RegistryKind, RegistryPatch } from '@shared/registry';
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

/** Adds a registry, or edits one when `registry` is given. Kumi checks the registry answers before saving. */
export function RegistryDialog({ registry, onClose }: { registry?: RegistryInfo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(registry?.name ?? '');
  const [kind, setKind] = useState<RegistryKind>(registry?.kind ?? 'api');
  const [location, setLocation] = useState(registry?.location ?? '');
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      if (!registry) return api.registriesAdd({ name, kind, location, ...(token ? { token } : {}) });
      const patch: RegistryPatch = {};
      if (name !== registry.name) patch.name = name;
      if (kind !== registry.kind) patch.kind = kind;
      if (location !== registry.location) patch.location = location;
      if (removeToken) patch.token = null;
      else if (token) patch.token = token;
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
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !location.trim()} onClick={() => save.mutate()}>
            {registry ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && location.trim()) save.mutate();
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
        <Field label="Token (optional)" help="Sent as a bearer token to this registry only, over https. Stored encrypted with your OS keychain.">
          <Input
            type="password"
            autoComplete="off"
            value={token}
            disabled={removeToken}
            onChange={(e) => setToken(e.target.value)}
            placeholder={registry?.hasToken ? 'Saved. Leave empty to keep it.' : 'None'}
          />
        </Field>
        {registry?.hasToken && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-accent" checked={removeToken} onChange={(e) => setRemoveToken(e.target.checked)} />
            Remove the saved token
          </label>
        )}
        {save.isPending && <p className="text-xs text-muted">Checking the registry…</p>}
        {save.error && <Callout tone="danger">{errorMessage(save.error)}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
