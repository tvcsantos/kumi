import type { RuntimeStatus } from '@shared/types';
import { refreshPath, which } from '../host';

const RUNTIMES: { name: string; installHint: string }[] = [
  { name: 'npx', installHint: 'Install Node.js from https://nodejs.org (includes npx).' },
  { name: 'uvx', installHint: 'Install uv: https://docs.astral.sh/uv/getting-started/installation/' },
  { name: 'docker', installHint: 'Install Docker Desktop: https://docs.docker.com/get-docker/' },
  { name: 'dnx', installHint: 'Install the .NET 10 SDK: https://dotnet.microsoft.com/download' },
];

/** The install hint for a runtime Kumi knows, e.g. "npx"; undefined for any other command. */
export function installHintFor(command: string | undefined): string | undefined {
  return RUNTIMES.find((r) => r.name === command)?.installHint;
}

async function find(): Promise<RuntimeStatus[]> {
  return Promise.all(RUNTIMES.map(async (r) => ({ ...r, path: await which(r.name) })));
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
