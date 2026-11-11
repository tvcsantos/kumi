// The registries Kumi searches: the built-in official one plus any the user adds. Secret header values are stored encrypted.

import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { HEADER_NAME, OFFICIAL_REGISTRY_ID, RESERVED_HEADERS, type RegistryDraft, type RegistryHeader, type RegistryInfo, type RegistryKind, type RegistryPatch } from '@shared/registry';
import { atomicWrite, readTextOrNull } from '../config-io/fs';
import type { SecretBox } from '../secrets/secrets';
import { DEFAULT_REGISTRY_URL } from './registry';

interface StoredRegistry {
  id: string;
  name: string;
  kind: RegistryKind;
  location: string;
  enabled: boolean;
  /** Request headers in order. Plain ones carry their value; secret ones only their name. */
  headers?: RegistryHeader[];
  /** Values of the secret headers as a JSON object keyed by name, encrypted with the OS keychain (base64). */
  encryptedSecrets?: string;
}

interface RegistriesFile {
  version: 1;
  officialEnabled: boolean;
  registries: StoredRegistry[];
}

const OFFICIAL_NAME = 'Official MCP Registry';

/** A header with its value, secret or not. Main process only. */
export type HeaderValue = RegistryHeader & { value: string };

/** A registry with its secret header values decrypted, for the main process only. */
export interface ResolvedRegistry extends RegistryInfo {
  headers: HeaderValue[];
}

/** The headers as `fetch` takes them, or undefined when there are none. */
export function headerRecord(headers: HeaderValue[] | undefined): Record<string, string> | undefined {
  return headers?.length ? Object.fromEntries(headers.map((h) => [h.name, h.value])) : undefined;
}

/**
 * Fills in the values a header list leaves out: a secret header without a value keeps the secret saved under the
 * same name (ignoring case). A secret can't become plain without its value being entered again.
 */
export function applyHeaders(saved: HeaderValue[], input: RegistryHeader[]): HeaderValue[] {
  return input.map((h) => {
    const name = h.name.trim();
    if (h.value !== undefined) return { name, secret: h.secret, value: h.value };
    const prev = saved.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!h.secret || !prev?.secret) throw new Error(`Enter a value for the ${name} header`);
    return { name, secret: true, value: prev.value };
  });
}

/** Throws unless every header has a valid name, isn't one Kumi sets, appears once, and has a single-line value. */
export function validateHeaders(headers: HeaderValue[]): void {
  const seen = new Set<string>();
  for (const { name, value } of headers) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name)) throw new Error(`"${name}" isn't a valid header name`);
    if (RESERVED_HEADERS.includes(lower)) throw new Error(`The ${name} header is set by the HTTP connection and can't be changed`);
    if (seen.has(lower)) throw new Error(`The ${name} header is listed twice`);
    if (!value.trim()) throw new Error(`Enter a value for the ${name} header`);
    if (/[\r\n\0]/.test(value)) throw new Error(`The ${name} header value must be a single line`);
    seen.add(lower);
  }
}

const isLocalHost = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** Throws when a location doesn't fit its kind, or secret headers would travel unencrypted. */
export function validateLocation(kind: RegistryKind, location: string, hasSecrets: boolean): void {
  if (kind === 'file' && isAbsolute(location)) return;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new Error(kind === 'api' ? 'Enter the registry URL, e.g. https://registry.example.com/v0.1' : 'Enter a URL or an absolute file path');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https URLs are supported');
  if (hasSecrets && url.protocol === 'http:' && !isLocalHost(url)) throw new Error('Secret headers can only be sent over https');
}

export class RegistryStore {
  private file: RegistriesFile | null = null;
  private readonly path: string;

  constructor(
    dataDir: string,
    private readonly box: SecretBox,
  ) {
    this.path = join(dataDir, 'registries.json');
  }

  private async load(): Promise<RegistriesFile> {
    if (!this.file) {
      const parsed = JSON.parse((await readTextOrNull(this.path)) ?? '{}') as Partial<RegistriesFile>;
      this.file = { version: 1, officialEnabled: parsed.officialEnabled ?? true, registries: parsed.registries ?? [] };
    }
    return this.file;
  }

  private async save() {
    await atomicWrite(this.path, JSON.stringify(this.file, null, 2) + '\n');
  }

  /** Sets (or clears, when empty) the stored headers, encrypting the secret values. */
  private async setHeaders(r: StoredRegistry, headers: HeaderValue[]) {
    delete r.headers;
    delete r.encryptedSecrets;
    if (!headers.length) return;
    r.headers = headers.map(({ name, secret, value }) => (secret ? { name, secret } : { name, secret, value }));
    const secrets = headers.filter((h) => h.secret);
    if (!secrets.length) return;
    if (!(await this.box.available())) throw new Error("Can't store secret headers securely: the OS keychain isn't available.");
    r.encryptedSecrets = await this.box.encrypt(JSON.stringify(Object.fromEntries(secrets.map((h) => [h.name, h.value]))));
  }

  /** The stored headers with their secret values decrypted. */
  private async headerValues(r: StoredRegistry): Promise<HeaderValue[]> {
    let secrets: Record<string, string> = {};
    if (r.encryptedSecrets) {
      try {
        secrets = JSON.parse(await this.box.decrypt(r.encryptedSecrets)) as Record<string, string>;
      } catch {
        throw new Error(`Couldn't decrypt the secret headers for "${r.name}". Edit the registry and enter them again.`);
      }
    }
    return (r.headers ?? []).map((h) => ({ ...h, value: (h.secret ? secrets[h.name] : h.value) ?? '' }));
  }

  private info(r: StoredRegistry): RegistryInfo {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      location: r.location,
      enabled: r.enabled,
      builtIn: false,
      headers: (r.headers ?? []).map((h) => ({ ...h })),
    };
  }

  /** Official first, then the user's registries in the order they were added. */
  async list(): Promise<RegistryInfo[]> {
    const file = await this.load();
    const official: RegistryInfo = {
      id: OFFICIAL_REGISTRY_ID,
      name: OFFICIAL_NAME,
      kind: 'api',
      location: DEFAULT_REGISTRY_URL,
      enabled: file.officialEnabled,
      builtIn: true,
      headers: [],
    };
    return [official, ...file.registries.map((r) => this.info(r))];
  }

  /** The registry with its secret header values decrypted, or undefined if it isn't configured. */
  async resolve(id: string): Promise<ResolvedRegistry | undefined> {
    const info = (await this.list()).find((r) => r.id === id);
    if (!info) return undefined;
    const stored = (await this.load()).registries.find((r) => r.id === id);
    return { ...info, headers: stored ? await this.headerValues(stored) : [] };
  }

  async add(draft: RegistryDraft): Promise<RegistryInfo> {
    const file = await this.load();
    const headers = applyHeaders([], draft.headers ?? []);
    validateHeaders(headers);
    validateLocation(draft.kind, draft.location, headers.some((h) => h.secret));
    const stored: StoredRegistry = {
      id: randomUUID(),
      name: draft.name.trim(),
      kind: draft.kind,
      location: draft.location.trim(),
      enabled: true,
    };
    await this.setHeaders(stored, headers);
    file.registries.push(stored);
    await this.save();
    return this.info(stored);
  }

  async update(id: string, patch: RegistryPatch): Promise<RegistryInfo> {
    const file = await this.load();
    if (id === OFFICIAL_REGISTRY_ID) {
      if (Object.keys(patch).some((k) => k !== 'enabled')) throw new Error('The official registry can only be turned on or off');
      if (patch.enabled !== undefined) file.officialEnabled = patch.enabled;
      await this.save();
      return (await this.list())[0];
    }
    const stored = file.registries.find((r) => r.id === id);
    if (!stored) throw new Error('Registry not found');
    const next: StoredRegistry = { ...stored };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.kind !== undefined) next.kind = patch.kind;
    if (patch.location !== undefined) next.location = patch.location.trim();
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.headers !== undefined) {
      const headers = applyHeaders(await this.headerValues(stored), patch.headers);
      validateHeaders(headers);
      await this.setHeaders(next, headers);
    }
    validateLocation(next.kind, next.location, !!next.headers?.some((h) => h.secret));
    file.registries = file.registries.map((r) => (r.id === id ? next : r));
    await this.save();
    return this.info(next);
  }

  async remove(id: string): Promise<void> {
    if (id === OFFICIAL_REGISTRY_ID) throw new Error("The official registry can't be removed; turn it off instead");
    const file = await this.load();
    file.registries = file.registries.filter((r) => r.id !== id);
    await this.save();
  }
}
