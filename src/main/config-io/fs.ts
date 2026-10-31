import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/** Reads a text file; a missing file reads as null. */
export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function hashText(text: string | null): string {
  return text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
}

/** Writes via a temp file + rename so a crash never leaves a half-written config. Keeps the original file mode. */
export async function atomicWrite(path: string, text: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await fs.stat(path)).mode & 0o777;
  } catch {
    mode = undefined;
  }
  const tmp = `${path}.kumi-${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.open(tmp, 'w', mode ?? 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}
