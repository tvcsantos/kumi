// A small append-only log file for things worth reading after the fact, like a failed "Test connection".
// Each entry's first line also goes to the console, so `npm run dev` shows it in the terminal.

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

/** Past this size the file is moved to `kumi.old.log` (replacing the previous one) and a new one starts. */
const MAX_BYTES = 2 * 1024 * 1024;

export class FileLog {
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly maxBytes = MAX_BYTES,
  ) {
    this.file = join(dir, 'kumi.log');
  }

  /** Writes are queued, so entries never interleave; a failed write is reported to the console and dropped. */
  write(level: LogLevel, scope: string, message: string, detail?: string): Promise<void> {
    const head = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}\n`;
    const body = detail ? `${detail.replace(/\s+$/, '').replace(/^/gm, '    ')}\n` : '';
    this.queue = this.queue.then(() => this.append(head + body)).catch((e) => console.error(`[log] couldn't write ${this.file}: ${String(e)}`));
    return this.queue;
  }

  private async append(text: string) {
    await mkdir(this.dir, { recursive: true });
    const size = await stat(this.file).then((s) => s.size, () => 0);
    if (size > 0 && size + text.length > this.maxBytes) await rename(this.file, join(this.dir, 'kumi.old.log'));
    await appendFile(this.file, text, { mode: 0o600 });
  }
}

let current: FileLog | undefined;

/** Starts writing to `<dir>/kumi.log`. Until then (and in tests) entries only reach the console. */
export function initLog(dir: string): FileLog {
  current = new FileLog(dir);
  return current;
}

export function logFile(): string | undefined {
  return current?.file;
}

export function log(level: LogLevel, scope: string, message: string, detail?: string): Promise<void> {
  const line = `[${scope}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
  return current?.write(level, scope, message, detail) ?? Promise.resolve();
}
