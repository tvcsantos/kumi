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
  /** Check GitHub for a newer Kumi on startup and every few hours. */
  autoCheckUpdates: boolean;
  /** `prerelease` also offers release candidates. */
  updateChannel: UpdateChannel;
}

export type UpdateChannel = 'stable' | 'prerelease';

/**
 * How this copy of Kumi was installed, which decides how it updates.
 * `homebrew` is left to `brew upgrade`; `dev` is an unpackaged build.
 */
export type InstallKind = 'homebrew' | 'mac' | 'windows' | 'appimage' | 'linux-package' | 'dev';

export interface ReleaseInfo {
  version: string;
  /** The GitHub release page: notes and every download. */
  url: string;
  name?: string;
  publishedAt?: string;
  prerelease: boolean;
}

export interface UpdateStatus {
  /**
   * `available` → `downloading` → `ready` for installs Kumi updates itself (`inApp`).
   * A failed check or download keeps what an earlier one found, with `error` saying why.
   */
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  installKind: InstallKind;
  /** Kumi downloads and installs updates itself; otherwise the user gets a link or `command`. */
  inApp: boolean;
  /** Why this install can't update itself, when the reason is worth telling the user. */
  manualReason?: string;
  /** A shell command that updates this install, when a package manager owns it. */
  command?: string;
  /** The newest release on the chosen channel, once a check has succeeded. */
  latest?: ReleaseInfo;
  /** Download progress, 0–1, while `downloading`. */
  progress?: number;
  /** When the last check finished (ms since epoch). */
  checkedAt?: number;
  error?: string;
  /** The banner for `latest` was dismissed this session. */
  dismissed: boolean;
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
  updateStatus(): Promise<UpdateStatus>;
  /** Checks GitHub now, whatever the settings say. */
  updateCheck(): Promise<UpdateStatus>;
  /** Hides the update banner for this version until Kumi restarts. */
  updateDismiss(version: string): Promise<UpdateStatus>;
  /** Downloads the latest release again after a failed download. */
  updateDownload(): Promise<UpdateStatus>;
  /** Quits, installs the downloaded update and starts the new version. */
  updateRestart(): Promise<void>;
  copyText(text: string): Promise<void>;
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
  'updateStatus',
  'updateCheck',
  'updateDismiss',
  'updateDownload',
  'updateRestart',
  'copyText',
] as const satisfies readonly (keyof KumiApi)[];

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const channel = (method: keyof KumiApi) => `kumi:${method}`;
