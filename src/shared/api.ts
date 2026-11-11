// The renderer ↔ main contract. The preload script exposes exactly this as `window.kumi`.

import type { CatalogPage, RegistryDraft, RegistryInfo, RegistryPatch, RegistryServer } from './registry';
import type {
  ApplyResult,
  BackupInfo,
  ClientId,
  ClientInfo,
  HealthResult,
  InstallPlan,
  InstallRequest,
  InstalledView,
  RuntimeStatus,
  ScopeRef,
  SecretsMode,
  ServerSpec,
} from './types';

/** `system` follows the OS appearance. */
export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  defaultSecretsMode: SecretsMode;
  theme: ThemeSetting;
  /** The first-run welcome screen has been completed. */
  setupDone: boolean;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataDir: string;
}

export interface UninstallTarget {
  clientId: ClientId;
  scope: ScopeRef;
  name: string;
}

export interface KumiApi {
  appInfo(): Promise<AppInfo>;
  /** Searches one registry, or every enabled one when `registryId` is omitted. */
  catalogSearch(query: string, cursor?: string, registryId?: string): Promise<CatalogPage>;
  catalogGet(registryId: string, name: string, version?: string): Promise<RegistryServer>;
  registriesList(): Promise<RegistryInfo[]>;
  /** Checks the registry answers, then saves it. */
  registriesAdd(draft: RegistryDraft): Promise<RegistryInfo>;
  registriesUpdate(id: string, patch: RegistryPatch): Promise<RegistryInfo>;
  registriesRemove(id: string): Promise<void>;
  clientsList(): Promise<ClientInfo[]>;
  runtimesCheck(): Promise<RuntimeStatus[]>;
  installPlan(request: InstallRequest): Promise<InstallPlan>;
  installApply(planId: string): Promise<ApplyResult[]>;
  installedList(): Promise<InstalledView>;
  installedValues(recordId: string): Promise<Record<string, string>>;
  uninstall(target: UninstallTarget, force?: boolean): Promise<ApplyResult>;
  backupsList(): Promise<BackupInfo[]>;
  backupsRestore(id: string): Promise<BackupInfo>;
  projectsAdd(dir: string): Promise<void>;
  projectsRemove(dir: string): Promise<void>;
  healthTest(spec: ServerSpec): Promise<HealthResult>;
  pickDirectory(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  /** Opens a client config file (or Kumi backup) in the default editor. */
  openConfig(path: string): Promise<void>;
  revealConfig(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  settingsGet(): Promise<Settings>;
  settingsSet(patch: Partial<Settings>): Promise<Settings>;
}

export const API_METHODS = [
  'appInfo',
  'catalogSearch',
  'catalogGet',
  'registriesList',
  'registriesAdd',
  'registriesUpdate',
  'registriesRemove',
  'clientsList',
  'runtimesCheck',
  'installPlan',
  'installApply',
  'installedList',
  'installedValues',
  'uninstall',
  'backupsList',
  'backupsRestore',
  'projectsAdd',
  'projectsRemove',
  'healthTest',
  'pickDirectory',
  'pickFile',
  'openConfig',
  'revealConfig',
  'openExternal',
  'settingsGet',
  'settingsSet',
] as const satisfies readonly (keyof KumiApi)[];

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const channel = (method: keyof KumiApi) => `kumi:${method}`;
