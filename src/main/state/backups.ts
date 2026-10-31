import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { BackupInfo, ClientId } from '@shared/types';
import { atomicWrite, readTextOrNull } from '../config-io/fs';

const KEEP_PER_FILE = 20;

/** Copies of config files taken right before each write, with one-step restore. */
export class BackupService {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'backups');
    this.indexPath = join(this.dir, 'index.json');
  }

  async list(): Promise<BackupInfo[]> {
    const text = await readTextOrNull(this.indexPath);
    return text ? (JSON.parse(text) as BackupInfo[]) : [];
  }

  private async saveIndex(list: BackupInfo[]) {
    await atomicWrite(this.indexPath, JSON.stringify(list, null, 2) + '\n');
  }

  /** Saves `content` (null when the file didn't exist yet) as the pre-write state of `originalPath`. */
  async create(clientId: ClientId, originalPath: string, content: string | null): Promise<BackupInfo> {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const backupPath = join(this.dir, clientId, `${createdAt.replace(/[:.]/g, '-')}-${id.slice(0, 8)}-${basename(originalPath)}`);
    await atomicWrite(backupPath, content ?? '');
    const info: BackupInfo = { id, clientId, originalPath, backupPath, createdAt, existed: content !== null };

    const list = [...(await this.list()), info];
    const forFile = list.filter((b) => b.originalPath === originalPath);
    const expired = forFile.slice(0, Math.max(0, forFile.length - KEEP_PER_FILE));
    for (const old of expired) await fs.rm(old.backupPath, { force: true });
    await this.saveIndex(list.filter((b) => !expired.includes(b)));
    return info;
  }

  /** Puts the file back the way it was; the current content is itself backed up first. */
  async restore(id: string): Promise<BackupInfo> {
    const info = (await this.list()).find((b) => b.id === id);
    if (!info) throw new Error('Backup not found');
    await this.create(info.clientId, info.originalPath, await readTextOrNull(info.originalPath));
    if (info.existed) {
      const content = await readTextOrNull(info.backupPath);
      if (content === null) throw new Error('Backup file is missing');
      await atomicWrite(info.originalPath, content);
    } else {
      await fs.rm(info.originalPath, { force: true });
    }
    return info;
  }
}
