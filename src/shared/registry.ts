// Subset of the official MCP Registry `server.json` schema that Kumi uses.
// https://registry.modelcontextprotocol.io

export interface RegistryInput {
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  format?: 'string' | 'number' | 'boolean' | 'filepath' | string;
  default?: string;
  value?: string;
  placeholder?: string;
  choices?: string[];
  variables?: Record<string, RegistryInput>;
}

export interface RegistryKeyValueInput extends RegistryInput {
  name: string;
}

export interface RegistryArgument extends RegistryInput {
  type: 'positional' | 'named';
  name?: string;
  valueHint?: string;
  isRepeated?: boolean;
}

export interface RegistryTransport {
  type: 'stdio' | 'streamable-http' | 'sse' | string;
  url?: string;
  headers?: RegistryKeyValueInput[];
}

export interface RegistryPackage {
  registryType: 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb' | string;
  registryBaseUrl?: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  transport?: RegistryTransport;
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryKeyValueInput[];
}

export interface RegistryRemote {
  type: 'streamable-http' | 'sse' | string;
  url: string;
  headers?: RegistryKeyValueInput[];
  variables?: Record<string, RegistryInput>;
}

export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  version: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string; subfolder?: string };
  icons?: { src: string; mimeType?: string; theme?: 'light' | 'dark' }[];
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
}

export interface RegistryServerResponse {
  server: RegistryServer;
  _meta?: Record<string, unknown>;
}

/** Id of the built-in official MCP Registry. Install records without a registry id came from it. */
export const OFFICIAL_REGISTRY_ID = 'official';

/** `api` speaks the MCP Registry API; `file` is one static JSON file listing servers. */
export type RegistryKind = 'api' | 'file';

/**
 * A request header sent to a registry. Secret values are stored encrypted and never leave the main process,
 * so the renderer sees them without `value`; plain values are stored and shown as they are.
 * When saving, a secret header without `value` keeps the value saved under the same name.
 */
export interface RegistryHeader {
  name: string;
  secret: boolean;
  value?: string;
}

/** A configured source of servers, as the renderer sees it. */
export interface RegistryInfo {
  id: string;
  name: string;
  kind: RegistryKind;
  /** API base URL, or the URL or absolute path of a static file. */
  location: string;
  enabled: boolean;
  /** The official registry: can be disabled, but not edited or removed. */
  builtIn: boolean;
  /** Headers sent with every request, e.g. `Authorization: Bearer …` (secret) or `X-Tenant` (plain). */
  headers: RegistryHeader[];
}

export interface RegistryDraft {
  name: string;
  kind: RegistryKind;
  location: string;
  headers?: RegistryHeader[];
}

export interface RegistryPatch {
  name?: string;
  kind?: RegistryKind;
  location?: string;
  enabled?: boolean;
  /** Replaces the whole list. A secret header without a value keeps its saved one. */
  headers?: RegistryHeader[];
}

/** Valid HTTP header name (an RFC 9110 token). */
export const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Headers that belong to the HTTP connection, so fetch won't let us set them. */
export const RESERVED_HEADERS = ['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'expect'];

/** A server together with the registry it came from. */
export interface CatalogItem {
  registryId: string;
  server: RegistryServer;
}

export interface CatalogPage {
  items: CatalogItem[];
  nextCursor?: string;
  /** Registries that couldn't be searched; their servers are missing from this page. */
  failures?: { registryId: string; error: string }[];
}

/** One form field generated from registry metadata. */
export interface InputField {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  format: 'string' | 'number' | 'boolean' | 'filepath';
  default?: string;
  placeholder?: string;
  choices?: string[];
  group: 'env' | 'argument' | 'header' | 'url';
}

/** One way to install a server: a package run locally, or a hosted remote. */
export interface InstallVariant {
  ref: { kind: 'package'; index: number } | { kind: 'remote'; index: number };
  label: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  /** Runtime binary needed on the machine, e.g. "npx". */
  runtime?: string;
  fields: InputField[];
  /** Set when Kumi can't install this variant. */
  unsupported?: string;
}
