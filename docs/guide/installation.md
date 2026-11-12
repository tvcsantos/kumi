# Installation

Kumi runs on macOS, Windows and Linux.

## Download

<DownloadCards repo="tvcsantos/kumi" />

All installers are also on the [releases page](https://github.com/tvcsantos/kumi/releases/latest). Releases with a suffix such as `-rc.1` are pre-releases.

| Platform | File |
|---|---|
| macOS (Apple silicon) | `Kumi-<version>-arm64.dmg` or `.zip` |
| macOS (Intel) | `Kumi-<version>-x64.dmg` or `.zip` |
| Windows | `Kumi-Setup-<version>.exe` |
| Linux | `Kumi-<version>.AppImage` or `kumi_<version>_amd64.deb` |

## macOS

### Homebrew

```bash
brew install --cask tvcsantos/kumi/kumi
```

This installs Kumi into `/Applications` and picks the right build for your Mac. The cask clears the Gatekeeper quarantine flag after installing, so the app opens without the warning below. Upgrade with:

```bash
brew upgrade --cask kumi
```

### Disk image

Open the `.dmg` and drag **Kumi** to **Applications**.

::: warning Unsigned builds
A build released without an Apple Developer ID certificate is ad-hoc signed. It runs on Apple silicon, but Gatekeeper doesn't trust it and will say the app "is damaged" or "can't be opened". To open it, clear the quarantine flag once after installing (Homebrew does this for you):

```bash
xattr -dr com.apple.quarantine /Applications/Kumi.app
```
:::

## Windows

Run `Kumi-Setup-<version>.exe`. The installer lets you choose the install folder.

If the installer is unsigned, SmartScreen may warn about an unrecognized app. Choose **More info**, then **Run anyway**.

## Linux

**AppImage**: make it executable and run it.

```bash
chmod +x Kumi-*.AppImage
./Kumi-*.AppImage
```

**Debian / Ubuntu**: install the `.deb` package.

```bash
sudo apt install ./kumi_*_amd64.deb
```

## What Kumi needs on your machine

Kumi itself has no requirements. The servers you install run inside your AI apps, and most of them need a runtime to start:

| Runtime | Used for | Install |
|---|---|---|
| `npx` | npm packages, and the `mcp-remote` bridge | [Node.js](https://nodejs.org) |
| `uvx` | PyPI packages | [uv](https://docs.astral.sh/uv/getting-started/installation/) |
| `docker` | OCI images | [Docker Desktop](https://docs.docker.com/get-docker/) |
| `dnx` | NuGet packages | [.NET 10 SDK](https://dotnet.microsoft.com/download) |

**Settings → Runtimes** shows which ones Kumi found. On macOS and Linux, Kumi reads your `PATH` from your login shell, so tools installed through nvm, Homebrew, asdf and similar are found even when Kumi is opened from the Dock or a launcher.

## Build from source

You need Node.js 24 and npm.

```bash
git clone https://github.com/tvcsantos/kumi.git
cd kumi
npm install
npm run dist
```

The installers for your platform land in `dist/`. See [Development](../contributing/development) for running the app with hot reload.

## Next

[First run →](./first-run)
