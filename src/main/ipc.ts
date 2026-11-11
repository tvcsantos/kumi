// IPC handlers. Every argument from the renderer is validated before it reaches a service.

import { isAbsolute } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { z } from 'zod';
import { API_METHODS, channel, type IpcResult, type KumiApi } from '@shared/api';
import { CLIENT_IDS, type ClientInfo } from '@shared/types';
import type { Catalog } from './catalog/catalog';
import { ADAPTERS } from './clients';
import type { HostEnv } from './clients/types';
import { testServer } from './health/check';
import type { InstallService } from './install/service';
import { checkRuntimes } from './runtime/detect';
import type { SettingsStore } from './settings';
import type { BackupService } from './state/backups';
import type { StateStore } from './state/store';

const absPath = z.string().min(1).refine(isAbsolute, 'Must be an absolute path');
const clientId = z.enum(CLIENT_IDS);
const scope = z.object({ kind: z.enum(['user', 'project', 'local']), projectDir: absPath.optional() });
const stringMap = z.record(z.string(), z.string());
const serverSpec = z.object({
  name: z.string().min(1).max(100),
  transport: z.enum(['stdio', 'streamable-http', 'sse']),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMap.optional(),
  url: z.url({ protocol: /^https?$/ }).optional(),
  headers: stringMap.optional(),
  secretEnv: z.array(z.string()).optional(),
  secretHeaders: z.array(z.string()).optional(),
  secretArgs: z.array(z.number().int().nonnegative()).optional(),
}).refine((s) => (s.transport === 'stdio' ? !!s.command : !!s.url), 'stdio servers need a command; remote servers need a URL');
const registryId = z.string().min(1).max(100);
const variantRef = z.union([
  z.object({ kind: z.literal('package'), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('remote'), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('custom') }),
]);
const installRequest = z.object({
  spec: serverSpec,
  targets: z.array(z.object({ clientId, scope })).min(1),
  secretsMode: z.enum(['inline', 'client-native']),
  source: z.object({ registryId, registryName: z.string(), version: z.string(), variant: variantRef }).optional(),
  values: stringMap.optional(),
  secretValueKeys: z.array(z.string()).optional(),
  overwriteForeign: z.boolean().optional(),
});
const uninstallTarget = z.object({ clientId, scope, name: z.string().min(1) });
const settingsPatch = z.object({
  defaultSecretsMode: z.enum(['inline', 'client-native']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  setupDone: z.boolean().optional(),
});
const registryDraft = z.object({
  name: z.string().trim().min(1, 'Give the registry a name').max(60),
  kind: z.enum(['api', 'file']),
  location: z.string().trim().min(1, 'Enter a URL or file path').max(2000),
  headers: z
    .array(z.object({ name: z.string().max(200), secret: z.boolean(), value: z.string().max(4000).optional() }))
    .max(20, 'At most 20 headers')
    .optional(),
});
const registryPatch = registryDraft.partial().extend({ enabled: z.boolean().optional() });

export interface Services {
  env: HostEnv;
  dataDir: string;
  catalog: Catalog;
  installer: InstallService;
  state: StateStore;
  backups: BackupService;
  settings: SettingsStore;
}

type Handlers = { [K in keyof KumiApi]: (...args: unknown[]) => ReturnType<KumiApi[K]> };

function createHandlers(s: Services): Handlers {
  /** Only paths Kumi manages may be opened: client configs and our backups. */
  async function assertKnownPath(path: string) {
    const known = new Set<string>();
    const view = await s.installer.listInstalled();
    for (const e of [...view.entries, ...view.errors]) known.add(e.configPath);
    for (const a of ADAPTERS) if (a.scopes.includes('user')) known.add(a.configPath(s.env, { kind: 'user' }));
    for (const b of await s.backups.list()) known.add(b.backupPath);
    if (!known.has(path)) throw new Error('Not a config file managed by Kumi');
  }

  async function pick(properties: ('openDirectory' | 'openFile')[]) {
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, { properties }) : await dialog.showOpenDialog({ properties });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  }

  return {
    appInfo: async () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      dataDir: s.dataDir,
    }),
    catalogSearch: (q, cursor, id) =>
      s.catalog.search(z.string().max(200).parse(q), z.string().max(8000).optional().parse(cursor), registryId.optional().parse(id)),
    catalogGet: (id, name, version) => s.catalog.get(registryId.parse(id), z.string().min(1).max(300).parse(name), z.string().max(100).optional().parse(version)),
    registriesList: () => s.catalog.list(),
    registriesAdd: (draft) => s.catalog.add(registryDraft.parse(draft)),
    registriesUpdate: (id, patch) => s.catalog.update(registryId.parse(id), registryPatch.parse(patch)),
    registriesRemove: (id) => s.catalog.remove(registryId.parse(id)),
    clientsList: async () =>
      Promise.all(
        ADAPTERS.map(
          async (a): Promise<ClientInfo> => ({
            id: a.id,
            displayName: a.displayName,
            scopes: a.scopes,
            transports: a.transports,
            bridgedTransports: a.bridgeable,
            needsRestart: a.needsRestart,
            supportsSecureSecrets: a.supportsSecureSecrets,
            detected: await a.detect(s.env),
            userConfigPath: a.scopes.includes('user') ? a.configPath(s.env, { kind: 'user' }) : '',
          }),
        ),
      ),
    runtimesCheck: () => checkRuntimes(),
    installPlan: async (req) => {
      const request = installRequest.parse(req);
      for (const t of request.targets) if (t.scope.projectDir) await s.state.addProject(t.scope.projectDir);
      return s.installer.plan(request);
    },
    installApply: (id) => s.installer.apply(z.uuid().parse(id)),
    installedList: () => s.installer.listInstalled(),
    installedValues: (id) => s.installer.recordValues(z.uuid().parse(id)),
    uninstall: (target, force) => s.installer.uninstall(uninstallTarget.parse(target), z.boolean().optional().parse(force)),
    backupsList: async () => (await s.backups.list()).reverse(),
    backupsRestore: (id) => s.backups.restore(z.uuid().parse(id)),
    projectsAdd: (dir) => s.state.addProject(absPath.parse(dir)),
    projectsRemove: (dir) => s.state.removeProject(absPath.parse(dir)),
    healthTest: (spec) => testServer(serverSpec.parse(spec)),
    pickDirectory: () => pick(['openDirectory']),
    pickFile: () => pick(['openFile']),
    openConfig: async (path) => {
      const p = absPath.parse(path);
      await assertKnownPath(p);
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    },
    revealConfig: async (path) => {
      const p = absPath.parse(path);
      await assertKnownPath(p);
      shell.showItemInFolder(p);
    },
    openExternal: async (url) => {
      await shell.openExternal(z.url({ protocol: /^https?$/ }).parse(url));
    },
    settingsGet: () => s.settings.get(),
    settingsSet: async (patch) => {
      const next = await s.settings.set(settingsPatch.parse(patch));
      // The renderer's prefers-color-scheme follows this, so the CSS needs nothing else.
      nativeTheme.themeSource = next.theme;
      return next;
    },
  };
}

/** Registers every handler right away; calls made while services are still starting wait for them. */
export function registerIpc(services: Promise<Services>) {
  const handlers = services.then(createHandlers);
  for (const method of API_METHODS) {
    ipcMain.handle(channel(method), async (_event, ...args): Promise<IpcResult<unknown>> => {
      try {
        const handler = (await handlers)[method] as (...a: unknown[]) => Promise<unknown>;
        return { ok: true, value: await handler(...args) };
      } catch (e) {
        const message = e instanceof z.ZodError ? `Invalid input: ${e.issues.map((i) => i.message).join('; ')}` : e instanceof Error ? e.message : String(e);
        return { ok: false, error: message };
      }
    });
  }
}
