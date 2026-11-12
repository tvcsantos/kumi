import { app } from 'electron';
import type { InstallKind } from '@shared/api';
import { ElectronInstaller } from './electron-installer';
import type { ReleaseFeed } from './github';
import type { Installer } from './installer';
import { bundlePath, MacInstaller } from './mac-installer';

/** The installer for this kind of install, or null when updates are left to the user or a package manager. */
export function createInstaller(kind: InstallKind, feed: ReleaseFeed): Installer | null {
  switch (kind) {
    case 'windows':
    case 'appimage':
      return new ElectronInstaller(kind, feed);
    case 'mac':
      return new MacInstaller({
        appPath: bundlePath(process.execPath),
        arch: process.arch,
        feed,
        quit: () => app.quit(),
        onQuit: (callback) => app.on('will-quit', callback),
      });
    default:
      return null;
  }
}
