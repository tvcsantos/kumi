# Releasing

Releases are built by [`.github/workflows/release.yml`](https://github.com/tvcsantos/kumi/blob/main/.github/workflows/release.yml) when a version tag is pushed.

## Cut a release

```bash
npm version minor          # or patch / major / 0.2.0-rc.1; commits and tags vX.Y.Z
git push --follow-tags
```

The workflow then:

1. Checks the tag matches the version in `package.json`.
2. Runs the CI checks (typecheck, tests, build) on macOS, Windows and Linux.
3. Packages each platform:
   - macOS: `.dmg` and `.zip`, for x64 and arm64
   - Windows: NSIS installer
   - Linux: AppImage and `.deb`
4. Publishes a GitHub release with generated notes and all the installers.

Tags with a suffix such as `-rc.1` become pre-releases. Re-running the workflow after a partial failure uploads to the existing release instead of failing.

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
