// Domain types shared by the main process and the renderer.

export const CLIENT_IDS = ['claude-desktop', 'claude-code', 'vscode', 'cursor', 'codex', 'copilot-cli'] as const;
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
  error?: string;
  stderr?: string;
  durationMs: number;
}
