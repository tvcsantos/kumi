// The renderer ↔ main contract. The preload script exposes exactly this as `window.kumi`.

import type { PreparedBundle } from './mcpb';
import type { PrivateNetworkPattern } from './private-network';
import type { CatalogPage, RegistryDraft, RegistryInfo, RegistryPatch, RegistryServer } from './registry';
import type {
  ApplyResult,
  BackupInfo,
  ClientId,
  ClientInfo,
  HealthResult,
  HealthTestOptions,
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
  /**
   * Tell the user about every new release, and download it in the background. When off, Kumi still
   * checks on startup and every few hours, but only acts on important and required updates.
   */
  autoCheckUpdates: boolean;
  /** `prerelease` also offers release candidates. */
  updateChannel: UpdateChannel;
  /** Hosts the user says are on a private network (VPN, office). */
  privateNetworks: PrivateNetworkPattern[];
  /** Also treat names and ranges that can only be private (`*.internal`, `10.0.0.0/8`, …) as private. */
  privateNetworkBuiltIns: boolean;
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

/** `important` shows a banner that can't be dismissed; `required` blocks Kumi until it updates. */
export type UpdateLevel = 'important' | 'required';

export interface UpdateUrgency {
  level: UpdateLevel;
  /** The release that was marked. Every older version must update. */
  version: string;
  /** Its release page. */
  url: string;
  /** Why, from the marker. */
  reason?: string;
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
  /** The banner for `latest` was dismissed this session. Never true while `urgency` is set. */
  dismissed: boolean;
  /** Set when a release newer than this one is marked important or required. Known before any check, once seen. */
  urgency?: UpdateUrgency;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataDir: string;
  /** Where failed connection tests and other problems are written. */
  logFile?: string;
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
  /** Fetches the registry again now, ignoring the cache. Fails when it can't be reached. */
  registriesRefresh(id: string): Promise<void>;
  clientsList(): Promise<ClientInfo[]>;
  /** Looks up npx, uvx & co. `refreshPath` re-reads PATH first when one is missing, to catch a fresh install. */
  runtimesCheck(opts?: { refreshPath?: boolean }): Promise<RuntimeStatus[]>;
  /** Downloads an `mcpb` bundle, checks its hash and unpacks it; reuses it when it's already on disk. */
  bundlePrepare(url: string, sha256: string): Promise<PreparedBundle>;
  installPlan(request: InstallRequest): Promise<InstallPlan>;
  installApply(planId: string): Promise<ApplyResult[]>;
  installedList(): Promise<InstalledView>;
  installedValues(recordId: string): Promise<Record<string, string>>;
  uninstall(target: UninstallTarget, force?: boolean): Promise<ApplyResult>;
  backupsList(): Promise<BackupInfo[]>;
  backupsRestore(id: string): Promise<BackupInfo>;
  projectsAdd(dir: string): Promise<void>;
  projectsRemove(dir: string): Promise<void>;
  /** Never opens a browser unless `signIn` is set. */
  healthTest(spec: ServerSpec, opts?: HealthTestOptions): Promise<HealthResult>;
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
  /** Shows Kumi's log file in the file manager (or its folder, before anything was logged). */
  revealLog(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Quits Kumi. A downloaded update installs on the way out. */
  appQuit(): Promise<void>;
}

export const API_METHODS = [
  'appInfo',
  'catalogSearch',
  'catalogGet',
  'registriesList',
  'registriesAdd',
  'registriesUpdate',
  'registriesRemove',
  'registriesRefresh',
  'clientsList',
  'runtimesCheck',
  'bundlePrepare',
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
  'revealLog',
  'copyText',
  'appQuit',
] as const satisfies readonly (keyof KumiApi)[];

/** What still works while an update is required: the update itself, the release notes, the log, About and quitting. */
export const ALLOWED_WHILE_UPDATE_REQUIRED = [
  'appInfo',
  'clientsList',
  'settingsGet',
  'installedList',
  'openExternal',
  'updateStatus',
  'updateCheck',
  'updateDownload',
  'updateRestart',
  'revealLog',
  'copyText',
  'appQuit',
] as const satisfies readonly (keyof KumiApi)[];

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const channel = (method: keyof KumiApi) => `kumi:${method}`;
