import type { ClientId, ScopeKind, ScopeRef, SecretsMode, ServerSpec, Transport } from '@shared/types';

/** Machine facts adapters need; injected so tests can point everything at a temp dir. */
export interface HostEnv {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData: string;
  /** %LOCALAPPDATA% on Windows. */
  localAppData: string;
  /** $XDG_CONFIG_HOME or ~/.config. */
  xdgConfig: string;
  vars: Record<string, string | undefined>;
  which(bin: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

export interface RenderOptions {
  secretsMode: SecretsMode;
  platform: NodeJS.Platform;
}

export interface EditResult {
  text: string;
  warnings: string[];
}

export interface ClientAdapter {
  id: ClientId;
  displayName: string;
  scopes: ScopeKind[];
  /** Transports the client supports natively. */
  transports: Transport[];
  /** Transports reachable only through the mcp-remote stdio bridge. */
  bridgeable: Transport[];
  needsRestart: boolean;
  supportsSecureSecrets: boolean;
  configPath(env: HostEnv, scope: ScopeRef): string;
  detect(env: HostEnv): Promise<boolean>;
  /** Servers defined in `text` for `scope`, keyed by config name. Throws ConfigParseError on malformed files. */
  readServers(text: string, scope: ScopeRef): Record<string, ServerSpec>;
  /** Adds or replaces `spec.name`, leaving everything else in the file untouched. */
  upsert(text: string, spec: ServerSpec, scope: ScopeRef, opts: RenderOptions): EditResult;
  remove(text: string, name: string, scope: ScopeRef): string;
}
