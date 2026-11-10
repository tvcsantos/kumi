import type { ClientId } from '@shared/types';
import { claudeCode } from './claude-code';
import { claudeDesktop } from './claude-desktop';
import { codex } from './codex';
import { copilotCli } from './copilot-cli';
import { cursor } from './cursor';
import { opencode } from './opencode';
import { pi } from './pi';
import type { ClientAdapter } from './types';
import { vscode } from './vscode';

export const ADAPTERS: ClientAdapter[] = [claudeDesktop, claudeCode, vscode, cursor, codex, copilotCli, opencode, pi];

export function getAdapter(id: ClientId): ClientAdapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`Unknown client: ${id}`);
  return adapter;
}
