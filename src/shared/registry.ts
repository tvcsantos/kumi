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

export interface CatalogPage {
  servers: RegistryServer[];
  nextCursor?: string;
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
