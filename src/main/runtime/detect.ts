import { execFile } from 'node:child_process';
import { parseVersion } from '@shared/semver';
import type { RuntimeStatus } from '@shared/types';
import { refreshPath, which } from '../host';

const RUNTIMES: { name: string; installHint: string }[] = [
  { name: 'npx', installHint: 'Install Node.js from https://nodejs.org (includes npx).' },
  { name: 'uvx', installHint: 'Install uv: https://docs.astral.sh/uv/getting-started/installation/' },
  { name: 'docker', installHint: 'Install Docker Desktop: https://docs.docker.com/get-docker/' },
  { name: 'dnx', installHint: 'Install the .NET 10 SDK: https://dotnet.microsoft.com/download' },
  // Bundles (`.mcpb`) run their code with these directly.
  { name: 'node', installHint: 'Install Node.js from https://nodejs.org.' },
  { name: 'python3', installHint: 'Install Python 3 from https://www.python.org/downloads/' },
  { name: 'uv', installHint: 'Install uv: https://docs.astral.sh/uv/getting-started/installation/' },
];

/** The install hint for a runtime Kumi knows, e.g. "npx"; undefined for any other command. */
export function installHintFor(command: string | undefined): string | undefined {
  return RUNTIMES.find((r) => r.name === command)?.installHint;
}

/** Runtimes whose version a bundle can ask for (`compatibility.runtimes`). */
const VERSIONED = new Set(['node', 'python3']);

/** `<path> --version`, e.g. "22.11.0"; undefined when it can't be read. */
function versionOf(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: 3000, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      const v = err ? null : parseVersion(`${stdout} ${stderr}`);
      resolve(v ? v.join('.') : undefined);
    });
  });
}

async function find(): Promise<RuntimeStatus[]> {
  return Promise.all(
    RUNTIMES.map(async (r) => {
      const path = await which(r.name);
      const version = path && VERSIONED.has(r.name) ? await versionOf(path) : undefined;
      return { ...r, path, ...(version ? { version } : {}) };
    }),
  );
}

/**
 * Looks each runtime up on PATH. With `refreshPath`, a runtime that's missing triggers a fresh read of PATH first,
 * so one installed while Kumi is open shows up without a restart.
 */
export async function checkRuntimes(opts: { refreshPath?: boolean } = {}): Promise<RuntimeStatus[]> {
  const found = await find();
  if (!opts.refreshPath || found.every((r) => r.path)) return found;
  await refreshPath();
  return find();
}
