// macOS paths, whatever platform the tests run on.
import { posix } from 'node:path';
import type { InstallKind } from '@shared/api';

export interface InstallFacts {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  /** Whether a path exists. Injected so tests don't touch the disk. */
  exists: (path: string) => boolean;
  /** The running `.app` bundle, on macOS. */
  appPath?: string;
  home?: string;
}

/** Where Homebrew keeps installed casks: Apple silicon, then Intel. */
export const CASKROOMS = ['/opt/homebrew/Caskroom/kumi', '/usr/local/Caskroom/kumi'];

export const BREW_UPGRADE = 'brew upgrade --cask kumi';

export function detectInstallKind({ platform, isPackaged, env, exists, appPath, home }: InstallFacts): InstallKind {
  if (!isPackaged) return 'dev';
  switch (platform) {
    case 'darwin': {
      // The cask puts the app in an Applications folder; a copy elsewhere isn't the one brew manages.
      const appDirs = ['/Applications', ...(home ? [posix.join(home, 'Applications')] : [])];
      const inAppDir = !appPath || appDirs.includes(posix.dirname(appPath));
      return inAppDir && CASKROOMS.some(exists) ? 'homebrew' : 'mac';
    }
    case 'win32':
      return 'windows';
    default:
      // AppImage's runtime sets APPIMAGE to the image's path; anything else came from a package (.deb).
      return env.APPIMAGE ? 'appimage' : 'linux-package';
  }
}

/** The command that updates this install, when a package manager owns it. */
export function updateCommand(kind: InstallKind): string | undefined {
  return kind === 'homebrew' ? BREW_UPGRADE : undefined;
}
