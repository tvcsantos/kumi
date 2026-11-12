import type { InstallKind } from '@shared/api';

export interface InstallFacts {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  /** Whether a path exists. Injected so tests don't touch the disk. */
  exists: (path: string) => boolean;
}

/** Where Homebrew keeps installed casks: Apple silicon, then Intel. */
export const CASKROOMS = ['/opt/homebrew/Caskroom/kumi', '/usr/local/Caskroom/kumi'];

export const BREW_UPGRADE = 'brew upgrade --cask kumi';

export function detectInstallKind({ platform, isPackaged, env, exists }: InstallFacts): InstallKind {
  if (!isPackaged) return 'dev';
  switch (platform) {
    case 'darwin':
      return CASKROOMS.some(exists) ? 'homebrew' : 'mac';
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
