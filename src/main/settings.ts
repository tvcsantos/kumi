import { join } from 'node:path';
import type { Settings } from '@shared/api';
import { atomicWrite, readTextOrNull } from './config-io/fs';

const DEFAULTS: Settings = { defaultSecretsMode: 'inline', theme: 'system', setupDone: false };

export class SettingsStore {
  private readonly path: string;
  private current: Settings | null = null;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'settings.json');
  }

  async get(): Promise<Settings> {
    if (!this.current) {
      try {
        this.current = { ...DEFAULTS, ...JSON.parse((await readTextOrNull(this.path)) ?? '{}') };
      } catch {
        this.current = { ...DEFAULTS };
      }
    }
    return { ...this.current! };
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.current = { ...(await this.get()), ...patch };
    await atomicWrite(this.path, JSON.stringify(this.current, null, 2) + '\n');
    return { ...this.current };
  }
}
