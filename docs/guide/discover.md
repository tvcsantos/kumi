# Discover servers

**Discover** is where you find servers. It searches every registry that's turned on, all at once.

![Discover: featured servers, with filters for each registry](../screenshots/discover.png){.shot .light-only}
![Discover: featured servers, with filters for each registry](../screenshots/discover-dark.png){.shot .dark-only}

## Search

Type in the search box to search by name, title and description. Results come from every enabled registry; servers from registries you added are listed first, because they are usually the ones you are looking for.

With more than one registry turned on, a **Registry** filter lets you search just one of them. Each card shows which registry the server came from.

If one registry can't be reached, Kumi still shows results from the others and tells you which one failed.

## Featured servers

With an empty search, Discover shows a short list of featured servers from the official registry, grouped by category: developer tools, browser automation, productivity, design, payments and databases.

## Server cards

Each card shows the server's name, description and badges:

- **local**: the server has packages you run on your machine (npm, PyPI, Docker, NuGet).
- **hosted**: the server has a remote endpoint you connect to over HTTP.
- A **category** for featured servers.
- **private network**: the server only works on a VPN or office network. See [Servers on a private network](./test-connection#servers-on-a-private-network).
- **private registry**: its package downloads from a company registry. See [Packages from a private registry](./test-connection#packages-from-a-private-registry).

## Server detail

Click a card to open its detail page: description, version, links to its website and source repository, and the apps it's already installed in.

![Server detail with the ways to run it](../screenshots/server-detail.png){.shot .light-only}
![Server detail with the ways to run it](../screenshots/server-detail-dark.png){.shot .dark-only}

### Ways to run it

Many servers can run in more than one way. Kumi lists each one as a **variant**:

| Variant | What runs | Needs |
|---|---|---|
| `npm · <package>@<version>` | `npx -y <package>@<version>` | Node.js |
| `pypi · <package>@<version>` | `uvx <package>@<version>` | uv |
| `oci · <image>` | `docker run -i --rm <image>` | Docker |
| `nuget · <package>@<version>` | `dnx <package>@<version> --yes` | .NET 10 SDK |
| `mcpb · <file>@<version>` | the command in the bundle's manifest, e.g. `node <bundle>/server/index.js` | what the bundle runs on: Node.js, Python or uv, or nothing for a bundled program |
| `Hosted · <host>` | nothing local; your app connects to the URL | — |

Kumi pins the version the registry lists, so a server doesn't change under you. If a package names its own runtime (`runtimeHint`), Kumi uses that instead.

Each variant lists the settings it needs. A variant marked **not supported** can't be installed by Kumi yet, for example a package that runs as a local HTTP server.

An `mcpb` variant is an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb): a zip with the server's code and a manifest that says how to run it and which settings it takes. Its settings aren't known until the bundle is downloaded, so the detail page doesn't list them; the install wizard downloads the bundle when you pick it, checks it against the hash in the registry, and builds the form from its manifest. See [Bundles](../reference/registry-format#bundles-mcpb).

Click **Install** to start the [install wizard](./install).

## Offline

Registry responses are cached on disk for ten minutes. To fetch one again sooner, use **Refresh** in **Settings → Registries** ([more](./registries#refreshing-a-registry)). If a registry can't be reached, Kumi falls back to the last copy it has, so you can keep browsing offline.
