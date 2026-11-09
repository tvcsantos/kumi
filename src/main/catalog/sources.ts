// The registries Kumi searches: the built-in official one plus any the user adds. Tokens are stored encrypted.

import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { OFFICIAL_REGISTRY_ID, type RegistryDraft, type RegistryInfo, type RegistryKind, type RegistryPatch } from '@shared/registry';
import { atomicWrite, readTextOrNull } from '../config-io/fs';
import type { SecretBox } from '../secrets/secrets';
import { DEFAULT_REGISTRY_URL } from './registry';

interface StoredRegistry {
  id: string;
  name: string;
  kind: RegistryKind;
  location: string;
  enabled: boolean;
  /** Bearer token, encrypted with the OS keychain (base64). */
  encryptedToken?: string;
}

interface RegistriesFile {
  version: 1;
  officialEnabled: boolean;
  registries: StoredRegistry[];
}

const OFFICIAL_NAME = 'Official MCP Registry';

/** A registry with its token decrypted, for the main process only. */
export interface ResolvedRegistry extends RegistryInfo {
  token?: string;
}

const isLocalHost = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** Throws when a location doesn't fit its kind, or a token would travel unencrypted. */
export function validateLocation(kind: RegistryKind, location: string, hasToken: boolean): void {
  if (kind === 'file' && isAbsolute(location)) return;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new Error(kind === 'api' ? 'Enter the registry URL, e.g. https://registry.example.com/v0.1' : 'Enter a URL or an absolute file path');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https URLs are supported');
  if (hasToken && url.protocol === 'http:' && !isLocalHost(url)) throw new Error('A token can only be sent over https');
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

  private encryptToken(token: string): string {
    if (!this.box.available()) throw new Error("Can't store the token securely: the OS keychain isn't available.");
    return this.box.encrypt(token);
  }

  private info(r: StoredRegistry): RegistryInfo {
    return { id: r.id, name: r.name, kind: r.kind, location: r.location, enabled: r.enabled, builtIn: false, hasToken: !!r.encryptedToken };
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
      hasToken: false,
    };
    return [official, ...file.registries.map((r) => this.info(r))];
  }

  /** The registry with its token decrypted, or undefined if it isn't configured. */
  async resolve(id: string): Promise<ResolvedRegistry | undefined> {
    const info = (await this.list()).find((r) => r.id === id);
    if (!info) return undefined;
    const stored = (await this.load()).registries.find((r) => r.id === id);
    if (!stored?.encryptedToken) return info;
    try {
      return { ...info, token: this.box.decrypt(stored.encryptedToken) };
    } catch {
      throw new Error(`Couldn't decrypt the token for "${info.name}". Edit the registry and enter it again.`);
    }
  }

  async add(draft: RegistryDraft): Promise<RegistryInfo> {
    const file = await this.load();
    const token = draft.token || undefined;
    validateLocation(draft.kind, draft.location, !!token);
    const stored: StoredRegistry = {
      id: randomUUID(),
      name: draft.name.trim(),
      kind: draft.kind,
      location: draft.location.trim(),
      enabled: true,
      ...(token ? { encryptedToken: this.encryptToken(token) } : {}),
    };
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
    if (patch.token === null || patch.token === '') delete next.encryptedToken;
    else if (patch.token !== undefined) next.encryptedToken = this.encryptToken(patch.token);
    validateLocation(next.kind, next.location, !!next.encryptedToken);
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
