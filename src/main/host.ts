import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { HostEnv } from './clients/types';

/**
 * Set in shell profiles, so GUI launches don't see them: variables that move client config files, and the CA bundles
 * that servers started for "Test connection" (Node, Python, curl) need behind a corporate proxy or internal CA.
 */
const SHELL_VARS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'HERMES_HOME',
  'CLINE_DIR',
  'CLINE_DATA_DIR',
  'CLINE_MCP_SETTINGS_PATH',
  'XDG_CONFIG_HOME',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
];

/** Merges PATH lists in order, dropping empty entries and duplicates. */
export function mergePath(...lists: (string | undefined)[]): string {
  const entries = lists.flatMap((l) => (l ?? '').split(delimiter)).filter(Boolean);
  return [...new Set(entries)].join(delimiter);
}

/** Runs the user's login shell and reads the given variables, like a terminal sees them. */
function readLoginShell(vars: string[]): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__KUMI_ENV__';
  const script = vars.map((v) => `printf '${marker}${v}=%s${marker}' "$${v}"`).join('; ');
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
      const values: Record<string, string> = {};
      if (!err) for (const [, name, value] of stdout.matchAll(new RegExp(`${marker}([A-Z_]+)=(.*?)${marker}`, 'g'))) values[name] = value;
      resolve(values);
    });
  });
}

/**
 * GUI apps on macOS/Linux start with a minimal environment, so `npx`, `uvx` or `claude` installed through
 * nvm/Homebrew/etc. aren't found. Ask the user's login shell for PATH (and config-location vars), like a terminal sees.
 */
export async function loadShellEnv(): Promise<void> {
  if (process.platform === 'win32') return;
  const values = await readLoginShell(['PATH', ...SHELL_VARS]);
  for (const [name, value] of Object.entries(values)) {
    if (name === 'PATH') process.env.PATH = mergePath(value, process.env.PATH);
    else if (value && !process.env[name]) process.env[name] = value;
  }
}

const WINDOWS_PATH_KEYS = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment'];

/** Expands `%VAR%` references the way Windows does (names are case-insensitive), leaving unknown ones as they are. */
export function expandWindowsVars(value: string, vars: Record<string, string | undefined>): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase());
    return (key && vars[key]) || whole;
  });
}

/** Reads the `Path` value out of `reg query <key> /v Path` output; null when there is none. */
export function parseRegPath(stdout: string, vars: Record<string, string | undefined>): string | null {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(stdout);
  return m ? expandWindowsVars(m[1].trim(), vars) : null;
}

/** The system and user PATH as stored in the registry: installers update it, but running apps never see the change. */
async function readWindowsPath(): Promise<string> {
  const read = (key: string) =>
    new Promise<string | undefined>((resolve) => {
      execFile('reg', ['query', key, '/v', 'Path'], { timeout: 5000, encoding: 'utf8', windowsHide: true }, (err, stdout) =>
        resolve(err ? undefined : (parseRegPath(stdout, process.env) ?? undefined)),
      );
    });
  return mergePath(...(await Promise.all(WINDOWS_PATH_KEYS.map(read))));
}

const REFRESH_COOLDOWN_MS = 10_000;
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

/**
 * Re-reads PATH so a runtime installed while Kumi is open is found without a restart: from the login shell on
 * macOS/Linux, from the registry on Windows. Runs one at a time, and at most once per cooldown.
 */
export function refreshPath(): Promise<void> {
  if (refreshing) return refreshing;
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return Promise.resolve();
  refreshing = (async () => {
    try {
      if (process.platform === 'win32') process.env.PATH = mergePath(process.env.PATH, await readWindowsPath());
      else process.env.PATH = mergePath((await readLoginShell(['PATH'])).PATH, process.env.PATH);
    } finally {
      lastRefresh = Date.now();
      refreshing = null;
    }
  })();
  return refreshing;
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
