// What Kumi installed, where. Lets us update/uninstall our entries without touching ones users added by hand.

import { join } from 'node:path';
import type { ClientId, InstallRecord, ScopeRef } from '@shared/types';
import { atomicWrite, readTextOrNull } from '../config-io/fs';

interface StateFile {
  version: 1;
  records: InstallRecord[];
  /** Project folders the user has worked with, scanned for project-scoped configs. */
  projects: string[];
}

export function recordKey(r: { clientId: ClientId; configPath: string; scope: ScopeRef; name: string }): string {
  return [r.clientId, r.configPath, r.scope.kind, r.scope.projectDir ?? '', r.name].join('|');
}

export class StateStore {
  private state: StateFile = { version: 1, records: [], projects: [] };
  private readonly path: string;
  private loaded = false;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'state.json');
  }

  private async load(): Promise<StateFile> {
    if (!this.loaded) {
      const text = await readTextOrNull(this.path);
      if (text) {
        const parsed = JSON.parse(text) as Partial<StateFile>;
        this.state = { version: 1, records: parsed.records ?? [], projects: parsed.projects ?? [] };
      }
      this.loaded = true;
    }
    return this.state;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.path, JSON.stringify(this.state, null, 2) + '\n');
  }

  async records(): Promise<InstallRecord[]> {
    return [...(await this.load()).records];
  }

  async find(key: string): Promise<InstallRecord | undefined> {
    return (await this.load()).records.find((r) => recordKey(r) === key);
  }

  async findById(id: string): Promise<InstallRecord | undefined> {
    return (await this.load()).records.find((r) => r.id === id);
  }

  async upsert(record: InstallRecord): Promise<void> {
    const state = await this.load();
    const key = recordKey(record);
    state.records = [...state.records.filter((r) => recordKey(r) !== key), record];
    if (record.scope.projectDir && !state.projects.includes(record.scope.projectDir)) state.projects.push(record.scope.projectDir);
    await this.save();
  }

  async remove(key: string): Promise<void> {
    const state = await this.load();
    state.records = state.records.filter((r) => recordKey(r) !== key);
    await this.save();
  }

  async projects(): Promise<string[]> {
    return [...(await this.load()).projects];
  }

  async addProject(dir: string): Promise<void> {
    const state = await this.load();
    if (!state.projects.includes(dir)) {
      state.projects.push(dir);
      await this.save();
    }
  }

  async removeProject(dir: string): Promise<void> {
    const state = await this.load();
    state.projects = state.projects.filter((p) => p !== dir);
    await this.save();
  }
}
