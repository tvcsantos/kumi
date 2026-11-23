# Releasing

Releases are built by [`.github/workflows/release.yml`](https://github.com/tvcsantos/kumi/blob/main/.github/workflows/release.yml) when a version tag is pushed.

## Cut a release

```bash
npm run release -- minor   # or patch / major / 0.2.0-rc.1 / prerelease --preid rc; commits and tags vX.Y.Z
git push --follow-tags
```

`npm run release` needs a clean working tree. It bumps `package.json` and `package-lock.json`, commits, and creates the annotated tag. It doesn't push.

The workflow then:

1. Checks the tag matches the version in `package.json`.
2. Runs the CI checks (typecheck, tests, build) on macOS, Windows and Linux.
3. Packages each platform:
   - macOS: `.dmg` and `.zip`, for x64 and arm64
   - Windows: NSIS installer
   - Linux: AppImage and `.deb`
4. Publishes a GitHub release with generated notes and all the installers.

Tags with a suffix such as `-rc.1` become pre-releases. Re-running the workflow after a partial failure uploads to the existing release instead of failing.

## Important and required updates

To make users update, release with `release:important` or `release:required`. The reason is optional:

```bash
npm run release:required -- patch "Fixes a token leak in OAuth refresh"
npm run release:important -- minor "Fixes installs failing for Zed" --platforms windows,linux
git push --follow-tags
```

These add trailers to the tag's message (and the commit's):

| Trailer | Values |
|---|---|
| `Kumi-Update` | `important`: a banner that can't be dismissed. `required`: Kumi blocks everything but the update until it's installed. |
| `Kumi-Update-Reason` | Optional. One line shown to users. It can't contain `--`. |
| `Kumi-Update-Platforms` | Optional: `mac`, `windows`, `linux`, separated by commas. All platforms when left out. |

The workflow checks the trailers before building. Every release's notes then start with hidden lines listing the requirements still in force, one per level (and per platform set):

```
<!-- kumi:required 3.0.0 platforms=mac Fixes keychain access on macOS -->
<!-- kumi:required 2.0.0 Fixes a token leak in OAuth refresh -->
<!-- kumi:important 2.2.0 platforms=windows Fixes installs failing for Zed -->
```

A line means every version older than the one it names must update, on those platforms, to the latest release. The workflow copies the previous release's lines, adds this tag's, and drops any line a newer one covers (at least as severe, at least as new, on the same platforms or more). So an ordinary release still carries an earlier requirement, and the newest release alone tells Kumi what applies: someone on 1.0.0 is forced past a required 2.0.0 even when the newest release is an ordinary 3.0.0.

Requirements apply even when users turned automatic checks off. Kumi remembers them, and they can't be withdrawn. To add one to a published release, add a line to the newest release's notes on GitHub; the next release carries it forward.

A stable release only carries lines from stable releases, so a requirement set on a release candidate stays on the release candidate channel. To require the fix for stable users too, tag the stable release as required. The format and the carrying rules are in [`scripts/release-levels.mjs`](https://github.com/tvcsantos/kumi/blob/main/scripts/release-levels.mjs); Kumi reads the lines in [`src/main/updater/levels.ts`](https://github.com/tvcsantos/kumi/blob/main/src/main/updater/levels.ts).

## Homebrew cask

The macOS cask lives in [tvcsantos/homebrew-kumi](https://github.com/tvcsantos/homebrew-kumi) (`Casks/kumi.rb`). It isn't updated by the release workflow yet, so after each stable release bump `version` and both `sha256` values (arm64 and x64 `.dmg`) there. Pre-releases aren't published to the cask.

## Code signing

Signing is optional. Without these repository secrets, the Windows installer is unsigned and the macOS app is ad-hoc signed: it runs on Apple silicon, but Gatekeeper doesn't trust it.

| Secret | Purpose |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (`.p12`, base64) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization (needs the macOS certificate too) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate (`.pfx`, base64) and its password |

To open an ad-hoc signed build after installing it, clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Kumi.app
```

## Documentation

The docs site is deployed separately, by [`.github/workflows/docs.yml`](https://github.com/tvcsantos/kumi/blob/main/.github/workflows/docs.yml), on every push to `main` that changes `docs/`. It needs GitHub Pages enabled with **Source: GitHub Actions** in the repository settings.
