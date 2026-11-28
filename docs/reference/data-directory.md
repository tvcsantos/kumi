# Data directory

Kumi keeps its own state in one folder, `~/.kumi` by default. Set [`KUMI_DATA_DIR`](./environment#kumi-data-dir) to use another one. The **About** page shows the folder in use.

Your apps' config files are never stored here. Kumi edits them where they are.

```
~/.kumi/
├─ settings.json       theme, default secrets mode, first-run done
├─ registries.json     the registries you added, and whether the official one is on
├─ state.json          what Kumi installed, where, and the project folders it knows
├─ cache/
│  └─ registry.json    cached registry responses
├─ bundles/
│  ├─ index.json       where each bundle was downloaded from
│  └─ <sha256>/        one unpacked MCP Bundle, which app configs point at
└─ backups/
   ├─ index.json       list of backups
   └─ <app>/           one copy of a config file per write
      └─ <timestamp>-<id>-<file>
```

Files are written atomically, like config files. New files are only readable by you (`0600`).

## settings.json

```json
{
  "defaultSecretsMode": "inline",
  "theme": "system",
  "setupDone": true
}
```

| Key | Values |
|---|---|
| `defaultSecretsMode` | `inline` (write into config files) or `client-native` (use the app's secure storage) |
| `theme` | `system`, `light` or `dark` |
| `setupDone` | Whether the first-run screen was completed |

## registries.json

The registries you added. Plain header values are stored as they are; secret ones are stored together in `encryptedSecrets`, encrypted with the OS keychain.

```json
{
  "version": 1,
  "officialEnabled": true,
  "registries": [
    {
      "id": "…",
      "name": "Acme internal",
      "kind": "api",
      "location": "https://registry.acme.example/v0.1",
      "enabled": true,
      "headers": [{ "name": "Authorization", "secret": true }],
      "encryptedSecrets": "…"
    }
  ]
}
```

## state.json

One record per server Kumi installed, per app and scope. This is how Kumi knows which entries it [owns](../guide/safe-edits#ownership). It also lists the project folders shown in [Installed](../guide/installed#project-folders).

Each record holds the app, scope, config path and server name, where the server came from (registry, version and variant), the form values you entered (secret ones encrypted with the OS keychain), the secrets mode, and when it was installed and last updated.

Deleting a record doesn't touch your config; Kumi just treats that entry as added by hand.

`updateMarkers` lists releases newer than this Kumi that were marked important or required, so the requirement still applies offline. Each entry drops out once Kumi is on that version.

## cache/registry.json

Registry responses, keyed by URL. An entry is fresh for ten minutes; older entries are used only when the registry can't be reached. The cache keeps the 500 most recent responses. It's safe to delete.

## bundles/

[MCP Bundles](./registry-format#bundles-mcpb) Kumi downloaded, one folder per bundle, named by its SHA-256. Your apps run the server from here, so don't delete a folder an installed server uses. Installing the same bundle into several apps uses one folder; an update gets a new one.

Kumi deletes folders no config points at any more: when it starts, and after an install, an uninstall or a restore. `index.json` keeps each bundle's download URL even after its folder is gone, so restoring an older backup can download it again.

## backups/

A copy of each config file from right before every write, grouped by app. Kumi keeps the last 20 per file and deletes older ones. Restore them from **Settings → Backups**, or copy one back by hand.

## Resetting Kumi

Quit Kumi and delete the folder. Kumi starts again at the first-run screen. Servers it installed stay in your apps, now listed as *added manually*.
