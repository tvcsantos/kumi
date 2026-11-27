// Domain types shared by the main process and the renderer.

import type { PackageRegistry } from './package-registry';
import type { PrivateNetwork } from './private-network';

export const CLIENT_IDS = ['claude-desktop', 'claude-code', 'vscode', 'cursor', 'codex', 'copilot-cli', 'opencode', 'pi', 'junie', 'jetbrains-air', 'zed'] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export type ScopeKind = 'user' | 'project' | 'local';

export interface ScopeRef {
  kind: ScopeKind;
  /** Absolute project directory; required for `project` and `local` scopes. */
  projectDir?: string;
}

export type Transport = 'stdio' | 'streamable-http' | 'sse';

/** Client-independent description of how to run or reach one MCP server. */
export interface ServerSpec {
  /** Config key, e.g. "github". */
  name: string;
  transport: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Env var names whose values are secrets (masked in previews, client-native secret storage where supported). */
  secretEnv?: string[];
  /** Header names whose values are secrets. */
  secretHeaders?: string[];
  /** Argument indexes whose values are secrets (masked in previews). */
  secretArgs?: number[];
}

export interface ClientInfo {
  id: ClientId;
  displayName: string;
  scopes: ScopeKind[];
  transports: Transport[];
  needsRestart: boolean;
  /** Transports the client can only reach through the `mcp-remote` bridge. */
  bridgedTransports: Transport[];
  supportsSecureSecrets: boolean;
  detected: boolean;
  userConfigPath: string;
}

export type SecretsMode = 'inline' | 'client-native';

export interface InstallTarget {
  clientId: ClientId;
  scope: ScopeRef;
}

export interface InstallSource {
  /** Which configured registry the server came from. */
  registryId: string;
  registryName: string;
  version: string;
  variant: VariantRef;
  /** The registry's `private` flag when it was installed: the server only works on a private network. */
  privateNetwork?: { vpn?: string };
}

export type VariantRef = { kind: 'package'; index: number } | { kind: 'remote'; index: number } | { kind: 'custom' };

export interface InstallRequest {
  spec: ServerSpec;
  targets: InstallTarget[];
  secretsMode: SecretsMode;
  source?: InstallSource;
  /** Raw form values, kept so the install can be edited later. */
  values?: Record<string, string>;
  /** Keys of `values` that are secrets; stored encrypted. */
  secretValueKeys?: string[];
  /** Allow overwriting an existing entry Kumi doesn't own. */
  overwriteForeign?: boolean;
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'skip';
  text: string;
}

export interface PlannedChange {
  clientId: ClientId;
  scope: ScopeRef;
  configPath: string;
  /** True when the server name already exists in this config. */
  replaces: boolean;
  /** True when the existing entry was not created by Kumi. */
  foreign: boolean;
  /** Set when the client cannot use this server; nothing will be written. */
  error?: string;
  warnings: string[];
  diff: DiffLine[];
}

export interface InstallPlan {
  id: string;
  serverName: string;
  changes: PlannedChange[];
}

export interface ApplyResult {
  clientId: ClientId;
  configPath: string;
  ok: boolean;
  error?: string;
  backupPath?: string;
  needsRestart: boolean;
}

export interface InstalledEntry {
  clientId: ClientId;
  scope: ScopeRef;
  configPath: string;
  name: string;
  spec: ServerSpec;
  /** Present when Kumi created this entry. */
  record?: InstallRecord;
}

export interface ConfigError {
  clientId: ClientId;
  scope: ScopeRef;
  configPath: string;
  error: string;
}

export interface InstalledView {
  entries: InstalledEntry[];
  errors: ConfigError[];
  projects: string[];
}

export interface InstallRecord {
  id: string;
  name: string;
  clientId: ClientId;
  scope: ScopeRef;
  configPath: string;
  source?: InstallSource;
  /** Non-secret form values. */
  values?: Record<string, string>;
  /** Secret form values, encrypted with the OS keychain (base64). */
  encryptedSecrets?: string;
  secretsMode: SecretsMode;
  installedAt: string;
  updatedAt: string;
}

export interface BackupInfo {
  id: string;
  clientId: ClientId;
  originalPath: string;
  backupPath: string;
  createdAt: string;
  /** False when the original file didn't exist before the write; restoring removes it. */
  existed: boolean;
}

export interface RuntimeStatus {
  name: string;
  path: string | null;
  installHint: string;
}

export interface HealthResult {
  ok: boolean;
  serverName?: string;
  serverVersion?: string;
  tools: { name: string; description?: string }[];
  /**
   * Set when the server answered and asks for OAuth sign-in, which this test didn't do, so `tools` is empty.
   * `available` says whether Kumi can sign in (`healthTest(spec, { signIn: true })`); `reason` says why not.
   */
  signIn?: { available: boolean; reason?: string };
  error?: string;
  /** Set when a remote server couldn't be reached at all: its name doesn't resolve, nothing answered, or there's no route. */
  unreachable?: { cause: 'dns' | 'timeout' | 'route'; host: string };
  /** Set on failure when Kumi knows the server is on a private network: its registry says so, or its host matches a pattern. */
  privateNetwork?: PrivateNetwork;
  /** Set when a package couldn't be downloaded, from the package manager's output. */
  download?: DownloadFailure;
  stderr?: string;
  durationMs: number;
}

/** Why a package couldn't be downloaded. */
export interface DownloadFailure {
  /**
   * `network`: the registry couldn't be reached. `sign-in`: it wants credentials. `not-found`: no such package (or,
   * on a private registry, not without signing in). `no-mirror`: a private npm registry lacks a public dependency.
   * `tls`: its certificate isn't trusted.
   */
  cause: 'network' | 'sign-in' | 'not-found' | 'no-mirror' | 'tls';
  network?: 'dns' | 'timeout' | 'route' | 'refused' | 'reset' | 'tls';
  /** The registry host that failed, when known. */
  host?: string;
  /** The dependency that wasn't found, when it wasn't the package itself. */
  dependency?: string;
  /** The private registry on the command line, when there is one. */
  registry?: PackageRegistry;
  /** The test timed out and Kumi found the registry unreachable itself, so this is the likely cause rather than a reported one. */
  inferred?: boolean;
}

export interface HealthTestOptions {
  /** Sign in through the browser when the server asks for OAuth, then list its tools. */
  signIn?: boolean;
  /** The registry's `private` flag for this server, when it has one. */
  privateNetwork?: { vpn?: string };
}
