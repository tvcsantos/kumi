import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { HostEnv } from './clients/types';

/** Variables that move client config files; set in shell profiles, so GUI launches don't see them. */
const SHELL_VARS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME'];

/**
 * GUI apps on macOS/Linux start with a minimal environment, so `npx`, `uvx` or `claude` installed through
 * nvm/Homebrew/etc. aren't found. Ask the user's login shell for PATH (and config-location vars), like a terminal sees.
 */
export function loadShellEnv(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve();
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__KUMI_ENV__';
  const vars = ['PATH', ...SHELL_VARS];
  const script = vars.map((v) => `printf '${marker}${v}=%s${marker}' "$${v}"`).join('; ');
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
      if (!err) {
        for (const m of stdout.matchAll(new RegExp(`${marker}([A-Z_]+)=(.*?)${marker}`, 'g'))) {
          const [, name, value] = m;
          if (name === 'PATH') {
            const merged = [...value.split(delimiter), ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean);
            process.env.PATH = [...new Set(merged)].join(delimiter);
          } else if (value && !process.env[name]) {
            process.env[name] = value;
          }
        }
      }
      resolve();
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function which(bin: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

export function createHostEnv(): HostEnv {
  const home = homedir();
  return {
    home,
    platform: process.platform,
    appData: process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
    localAppData: process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
    xdgConfig: process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
    vars: process.env,
    which,
    exists,
  };
}
