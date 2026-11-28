// Downloads, checks and unpacks MCP Bundles (`.mcpb`) into `<dataDir>/bundles/<sha256>/`, where every app's config
// points. Folders are named by hash, so one bundle installed into several apps is unpacked once, and an update
// gets a new folder. `index.json` remembers where each hash was downloaded from, so restoring a config backup can
// fetch a bundle again after its folder was cleaned up.

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { bundleCommand, type BundleHost, type McpbManifest, type PreparedBundle } from '@shared/mcpb';
import { atomicWrite, readTextOrNull } from '../config-io/fs';

/** Largest download accepted. */
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
/** Largest unpacked size accepted, against zip bombs. */
export const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST = 'manifest.json';

const userConfig = z.object({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
const command = z.object({ command: z.string().min(1).optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() });
const manifestSchema = z.looseObject({
  // Bundles made before MCPB were called DXT and carry `dxt_version` instead.
  manifest_version: z.string().optional(),
  dxt_version: z.string().optional(),
  name: z.string().min(1),
  display_name: z.string().optional(),
  version: z.string().min(1),
  description: z.string().optional(),
  server: z.object({
    type: z.enum(['node', 'python', 'binary', 'uv']),
    entry_point: z.string().optional(),
    mcp_config: command.extend({ platform_overrides: z.record(z.string(), command).optional() }).optional(),
  }),
  user_config: z.record(z.string(), userConfig).optional(),
  compatibility: z.looseObject({ platforms: z.array(z.string()).optional(), runtimes: z.record(z.string(), z.string()).optional() }).optional(),
});

/** Reads and checks `manifest.json`. Throws a message for the user when it isn't one Kumi understands. */
export function parseManifest(text: string): McpbManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The bundle's manifest.json isn't valid JSON.");
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`The bundle's manifest.json isn't one Kumi understands (${issue.path.join('.') || 'root'}: ${issue.message}).`);
  }
  const { manifest_version, dxt_version, ...rest } = parsed.data;
  const version = manifest_version ?? dxt_version;
  if (!version) throw new Error("The bundle's manifest.json has no manifest_version.");
  if (!/^0\./.test(version)) throw new Error(`Bundle manifest version ${version} is newer than Kumi supports. Update Kumi and try again.`);
  return { ...(rest as Omit<McpbManifest, 'manifest_version'>), manifest_version: version };
}

/** The path inside `root` for a zip entry, or null when it would land outside (absolute, `..`, drive letters). */
export function safeEntryPath(root: string, name: string): string | null {
  const clean = name.replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean) || clean.split('/').includes('..')) return null;
  const target = normalize(join(root, clean));
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** Unpacks `zip` into `dir`, refusing entries that escape it and archives that unpack too big. */
async function unpack(zip: Uint8Array, dir: string): Promise<void> {
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        count += 1;
        if (total > MAX_UNPACKED_BYTES || count > MAX_ENTRIES) throw new Error('too-big');
        return true;
      },
    });
  } catch (e) {
    if ((e as Error).message === 'too-big') throw new Error('The bundle unpacks to more than Kumi accepts.');
    throw new Error("The bundle isn't a valid zip file.");
  }
  await fs.mkdir(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const target = safeEntryPath(dir, name);
    if (!target) throw new Error(`The bundle contains a file outside its folder (${name}).`);
    if (name.endsWith('/')) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
}

/** Zip doesn't keep the executable bit through fflate, so a binary bundle's program is made executable again. */
async function markExecutable(manifest: McpbManifest, dir: string, platform: string) {
  if (manifest.server.type !== 'binary' || platform === 'win32') return;
  const candidates = new Set<string>();
  const cmd = bundleCommand(manifest, platform).command;
  if (cmd?.startsWith('${__dirname}')) candidates.add(cmd.slice('${__dirname}'.length).replace(/^[\\/]+/, ''));
  if (manifest.server.entry_point) candidates.add(manifest.server.entry_point);
  for (const c of candidates) {
    const target = safeEntryPath(dir, c);
    if (target) await fs.chmod(target, 0o755).catch(() => undefined);
  }
}

async function download(fetchImpl: typeof fetch, url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: 'follow' });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(`Couldn't download the bundle from ${new URL(url).host}: ${cause?.code ?? cause?.message ?? (e as Error).message}`);
  }
  if (!res.ok) throw new Error(`Couldn't download the bundle: ${new URL(url).host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
  if (new URL(res.url || url).protocol !== 'https:') throw new Error('The bundle download was redirected away from HTTPS.');
  const length = Number(res.headers.get('content-length'));
  if (length > MAX_BUNDLE_BYTES) throw new Error('The bundle is larger than Kumi accepts.');
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BUNDLE_BYTES) throw new Error('The bundle is larger than Kumi accepts.');
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

interface IndexEntry {
  url: string;
  name?: string;
  version?: string;
  addedAt: string;
}

export interface BundleStoreOptions {
  dataDir: string;
  host: () => BundleHost;
  fetch?: typeof fetch;
}

export class BundleStore {
  readonly root: string;
  private readonly indexPath: string;
  private readonly host: () => BundleHost;
  private readonly fetchImpl: typeof fetch;
  /** Bundles prepared since Kumi started: kept by cleanup, as a wizard may be about to install them. */
  private readonly pinned = new Set<string>();
  private readonly inflight = new Map<string, Promise<PreparedBundle>>();

  constructor(opts: BundleStoreOptions) {
    this.root = join(opts.dataDir, 'bundles');
    this.indexPath = join(this.root, 'index.json');
    this.host = opts.host;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  dirFor(sha256: string): string {
    return join(this.root, sha256);
  }

  /** The bundle, unpacked: downloaded and checked first unless it's already on disk. */
  prepare(url: string, sha256: string): Promise<PreparedBundle> {
    const sha = sha256.toLowerCase();
    if (!SHA256.test(sha)) return Promise.reject(new Error('Invalid bundle hash.'));
    if (new URL(url).protocol !== 'https:') return Promise.reject(new Error('Kumi only downloads bundles over HTTPS.'));
    this.pinned.add(sha);
    const running = this.inflight.get(sha);
    if (running) return running;
    const job = this.load(url, sha).finally(() => this.inflight.delete(sha));
    this.inflight.set(sha, job);
    return job;
  }

  private async load(url: string, sha: string): Promise<PreparedBundle> {
    const dir = this.dirFor(sha);
    const host = this.host();
    const existing = await readTextOrNull(join(dir, MANIFEST));
    if (existing !== null) {
      const manifest = parseManifest(existing);
      await this.remember(sha, url, manifest);
      return { sha256: sha, dir, manifest, host };
    }

    const zip = await download(this.fetchImpl, url);
    const actual = createHash('sha256').update(zip).digest('hex');
    if (actual !== sha) throw new Error("The downloaded bundle doesn't match the hash in the registry, so Kumi didn't use it.");

    const tmp = join(this.root, `.tmp-${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
    try {
      await unpack(zip, tmp);
      const text = await readTextOrNull(join(tmp, MANIFEST));
      if (text === null) throw new Error('The bundle has no manifest.json.');
      const manifest = parseManifest(text);
      await markExecutable(manifest, tmp, host.platform);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rename(tmp, dir);
      await this.remember(sha, url, manifest);
      return { sha256: sha, dir, manifest, host };
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  private async index(): Promise<Record<string, IndexEntry>> {
    const text = await readTextOrNull(this.indexPath);
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, IndexEntry>;
    } catch {
      return {};
    }
  }

  /** Entries stay after the folder is cleaned up, so a restored backup can download it again. */
  private async remember(sha: string, url: string, manifest: McpbManifest) {
    const index = await this.index();
    if (index[sha]?.url === url) return;
    index[sha] = { url, name: manifest.name, version: manifest.version, addedAt: new Date().toISOString() };
    await atomicWrite(this.indexPath, JSON.stringify(index, null, 2) + '\n');
  }

  /**
   * Makes sure each bundle is on disk, downloading again the ones whose folder was cleaned up. Used before a backup is
   * restored. Throws when one can't be brought back, so the restore doesn't write a config that points at nothing.
   */
  async ensure(shas: string[]): Promise<void> {
    const index = await this.index();
    for (const sha of shas) {
      if ((await readTextOrNull(join(this.dirFor(sha), MANIFEST))) !== null) {
        this.pinned.add(sha);
        continue;
      }
      const entry = index[sha];
      if (!entry) throw new Error('This backup uses a bundle Kumi no longer has and doesn\'t know where to download again. Reinstall the server instead.');
      try {
        await this.prepare(entry.url, sha);
      } catch (e) {
        throw new Error(`This backup uses ${entry.name ?? 'a bundle'} ${entry.version ?? ''}, which Kumi had to download again and couldn't: ${(e as Error).message}`.replace(/\s+/g, ' '));
      }
    }
  }

  /** Deletes unpacked bundles nothing points at any more, and leftovers of interrupted downloads. */
  async cleanup(referenced: Iterable<string>): Promise<string[]> {
    const keep = new Set([...referenced, ...this.pinned, ...this.inflight.keys()]);
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const name of names) {
      const tmpOf = name.startsWith('.tmp-') ? name.slice(5, 17) : undefined;
      const stale = tmpOf !== undefined ? ![...this.inflight.keys()].some((k) => k.startsWith(tmpOf)) : SHA256.test(name) && !keep.has(name);
      if (!stale) continue;
      await fs.rm(join(this.root, name), { recursive: true, force: true });
      removed.push(name);
    }
    return removed;
  }
}
