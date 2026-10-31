import type { RuntimeStatus } from '@shared/types';
import { which } from '../host';

const RUNTIMES: { name: string; installHint: string }[] = [
  { name: 'npx', installHint: 'Install Node.js from https://nodejs.org (includes npx).' },
  { name: 'uvx', installHint: 'Install uv: https://docs.astral.sh/uv/getting-started/installation/' },
  { name: 'docker', installHint: 'Install Docker Desktop: https://docs.docker.com/get-docker/' },
  { name: 'dnx', installHint: 'Install the .NET 10 SDK: https://dotnet.microsoft.com/download' },
];

export async function checkRuntimes(): Promise<RuntimeStatus[]> {
  return Promise.all(RUNTIMES.map(async (r) => ({ ...r, path: await which(r.name) })));
}
