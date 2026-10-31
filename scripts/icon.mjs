// Renders build/icon.svg into the icon files electron-builder packages.
// Run with `npm run icon`. Uses Electron's own renderer, so nothing else needs installing.
//
//   build/icon.png      1024px, full bleed (Windows, Linux)
//   build/icon-mac.png  1024px on Apple's icon grid (dev Dock icon, source for the .icns)
//   build/icon.icns     macOS app icon (needs macOS's iconutil)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const SIZE = 1024;
// Apple's grid puts the rounded square at 824px inside the 1024px canvas.
const MAC_INSET = 100;

const buildDir = join(import.meta.dirname, '..', 'build');
const svg = readFileSync(join(buildDir, 'icon.svg'));

async function render(win, inset) {
  const box = SIZE - 2 * inset;
  const html = `<!doctype html><body style="margin:0;background:transparent">
<img src="data:image/svg+xml;base64,${svg.toString('base64')}" style="position:absolute;left:${inset}px;top:${inset}px;width:${box}px;height:${box}px">`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  // The corners must stay see-through, or every platform shows a square.
  if (image.toBitmap()[3] !== 0) throw new Error('Rendered icon has an opaque background');
  return image;
}

async function main() {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  try {
    writeFileSync(join(buildDir, 'icon.png'), (await render(win, 0)).toPNG());
    const mac = await render(win, MAC_INSET);
    writeFileSync(join(buildDir, 'icon-mac.png'), mac.toPNG());

    if (process.platform === 'darwin') {
      const iconset = join(mkdtempSync(join(tmpdir(), 'kumi-icon-')), 'icon.iconset');
      mkdirSync(iconset);
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          const px = size * scale;
          const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
          writeFileSync(join(iconset, name), mac.resize({ width: px, height: px, quality: 'best' }).toPNG());
        }
      }
      execFileSync('iconutil', ['-c', 'icns', '-o', join(buildDir, 'icon.icns'), iconset]);
      rmSync(join(iconset, '..'), { recursive: true, force: true });
    } else {
      console.warn('Skipped icon.icns: it can only be generated on macOS.');
    }
    console.log('Icons written to build/');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

// Electron only becomes ready once the entry module finishes, so no top-level await here.
app.dock?.hide();
void app.whenReady().then(main);
