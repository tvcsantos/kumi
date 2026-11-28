// Subset of the official MCP Registry `server.json` schema that Kumi uses.
// https://registry.modelcontextprotocol.io

import type { PackageRegistry } from './package-registry';

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
  /** SHA-256 of the downloaded file. The registry requires it for `mcpb` bundles. */
  fileSha256?: string;
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
  /** The publisher's extension data. The official registry keeps only `io.modelcontextprotocol.registry/publisher-provided`. */
  _meta?: Record<string, unknown>;
  /**
   * Not part of `server.json`: the `_meta` the registry sent next to this server (its own data about the entry, such
   * as `io.modelcontextprotocol.registry/official`). Kumi keeps it here so it travels with the server.
   */
  registryMeta?: Record<string, unknown>;
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
  format: 'string' | 'number' | 'boolean' | 'filepath' | 'directory';
  default?: string;
  placeholder?: string;
  choices?: string[];
  /** Several values, one per line. */
  multiple?: boolean;
  /** Bounds for `number` fields. */
  min?: number;
  max?: number;
  /** `config`: a bundle's `user_config` setting, which its manifest can pass as an argument or an env var. */
  group: 'env' | 'argument' | 'header' | 'url' | 'config';
}

/** Where an `mcpb` package's bundle comes from. */
export interface BundleSource {
  url: string;
  sha256: string;
  /** Env vars the registry entry lists. Only a hint: the bundle's manifest decides what it actually uses. */
  envHints?: string[];
}

/** One way to install a server: a package run locally, or a hosted remote. */
export interface InstallVariant {
  ref: { kind: 'package'; index: number } | { kind: 'remote'; index: number };
  label: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  /** Runtime binary needed on the machine, e.g. "npx". */
  runtime?: string;
  /** Bundles only: the version of `runtime` the bundle asks for, as a semver range, e.g. ">=20.18.1". */
  runtimeRange?: string;
  fields: InputField[];
  /** Set when Kumi can't install this variant. */
  unsupported?: string;
  /** Packages only: the private registry it downloads from. */
  privateRegistry?: PackageRegistry;
  /** Something the install wizard should point out, e.g. credentials left out of the registry URL. */
  warning?: string;
  /**
   * `mcpb` packages only: the bundle to download. Its settings and command come from the bundle's manifest, so until
   * it's downloaded (`bundleVariant` in `mcpb.ts`), `fields` is empty and `runtime` unknown.
   */
  bundle?: BundleSource;
}
