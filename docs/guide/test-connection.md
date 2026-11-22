# Test a connection

**Test connection** checks that a server actually works before you rely on it. It's available in the install wizard (on the configure step and after installing) and on every server in [Installed](./installed).

## What it does

For a **local** server, Kumi starts the command with the settings you entered, the same way your apps will, runs the MCP `initialize` handshake, asks for the list of tools, and stops the server.

For a **remote** server, Kumi connects to the URL with your headers over Streamable HTTP. If the server answers `404` or `405`, it retries with the older SSE transport. If nothing answers, Kumi says why: the name doesn't resolve, the host didn't answer, there's no route to it, or it refused the connection.

The result shows:

- the server's name and version, as it reports them;
- the tools it exposes, with their descriptions;
- how long it took;
- on failure, the error with a hint, and the server's stderr output.

For a server that asks you to sign in, it shows **Server is up** instead. See below.

::: warning It runs the server's code
Testing a local server runs third-party code on your machine with your permissions, just like your AI apps do when they start it. Only test servers you trust.
:::

## Servers that sign in with OAuth

Many hosted servers (Notion or Figma, for example) don't take an API key. They use MCP's OAuth sign-in instead. Your apps don't share a sign-in with Kumi: each one signs in on its own the first time it uses the server. So when such a server answers `401` and you haven't set an `Authorization` header, **Test** doesn't open your browser. It checks that the server is up and that it offers OAuth sign-in, and shows **Server is up**.

What comes next depends on the server:

- **Kumi can sign in.** The server lets apps register with it (dynamic client registration), or it accepts apps that describe themselves in a document they publish (a *client ID metadata document*). Kumi's is at [`https://tiago.santos.com.pt/kumi/oauth/client-metadata.json`](https://tiago.santos.com.pt/kumi/oauth/client-metadata.json). Either way, the result has a **Sign in to list tools** button. Click it to see the tools. Kumi then:
  1. opens the sign-in page in your browser;
  2. waits up to 5 minutes for you to approve, catching the redirect on `http://127.0.0.1:<port>/callback`;
  3. connects again with the new token and lists the tools.

  With a metadata document, the server only checks Kumi when the sign-in page opens. If it rejects Kumi then (for example, because it doesn't accept the random port Kumi listens on), it shows the error in your browser, and Kumi waits until the 5 minutes run out.
- **Only your apps can sign in.** Some servers only accept apps they approved in advance, or refuse to let new apps register. Figma is one. Kumi says so and stops there. Nothing is wrong on your side; your apps sign in with their own registration.

After you sign in, Kumi keeps the token in memory until you quit, so testing again lists the tools straight away. The token isn't saved to disk or shared with your apps.

If you set an `Authorization` header, Kumi sends only that header and skips OAuth.

Servers that answer with something other than `401` (GitHub's hosted server, for example) don't offer OAuth sign-in to Kumi, and still need a token in the `Authorization` header.

## Servers on a private network

Some servers only answer on a company VPN or office network. Your apps connect to them, not Kumi, so installing one works anywhere. But testing it while you're not connected can't work.

When Kumi can't reach a remote server at all (its name doesn't resolve, it doesn't answer, or there's no route to it), the result says **Not reachable from this network** instead of a failure, with what happened and what to do:

- If Kumi knows the server is on a private network, it says so, and names the network to connect to when it knows it: *mcp.acme.internal is on a private network (matches \*.internal): connect to your VPN and test again.*
- Otherwise it suggests it: *If this server is on a VPN or private network, connect and test again.*

Kumi knows a server is on a private network when:

- **its registry says so**. Registries can flag a server as private and name the VPN. See [Kumi's extension](../reference/registry-format#kumi-s-extension-private-network);
- **its host matches a pattern** in [Settings → Private networks](./settings#private-networks): your own patterns, like `*.acme.com`, or the built-in ones, like `*.internal` or `10.0.0.0/8`.

Such servers also show a **private network** badge on Discover, the server page and Installed, and a note in the install wizard.

For a **local** server, the connection to the private service happens inside the server, so Kumi can't see why it failed. If the registry flags the server as private, the failure adds: *This server only works on Acme GlobalProtect. If you're not connected, that may be why.* The same note is added to other failures of a private remote server, for example when a company gateway answers `403` because you're not on the network.

## Timeouts

The first run of an `npx`, `uvx` or `docker` server may download the package or image, so Kumi waits up to 90 seconds for its handshake. A remote server has nothing to download, so Kumi waits up to 15 seconds. Then it waits up to 30 seconds for the tool list.

## Common errors

| Error | What to check |
|---|---|
| *Is the command installed and on your PATH?* | The runtime (`npx`, `uvx`, `docker`, …) isn't installed, or isn't on your shell's `PATH`. **Settings → Runtimes** shows what Kumi found. |
| *Check your API key or token.* | The server answered `401 Unauthorized`, and it doesn't offer OAuth sign-in. |
| *Sign-in failed: …* | After **Sign in to list tools**: you declined in the browser, or the authorization server returned an error. |
| *Sign-in timed out after 5 minutes* | After **Sign in to list tools**: the browser sign-in wasn't finished. Click the button again to restart it. If it adds *this server may not accept Kumi's sign-in*, look for an error on the sign-in page: the server may have rejected Kumi's metadata document. |
| *The credentials don't have access.* | The server answered `403 Forbidden`. |
| *Timed out after 90s* | The server didn't finish the handshake. Look at its stderr output for clues. |
| *Couldn't find … : the name doesn't resolve* | The host name doesn't exist, or only resolves on a private network. Check the URL, or connect to your VPN. |
| *… didn't answer* | Nothing answered within the time limit. The host may only be reachable on a private network, or a firewall drops the connection. |
| *There's no network route to …* | Your computer has no way to reach that address, which usually means it's on a network you're not connected to. |
| *… refused the connection* | The host answered, but nothing is listening on that port. Check the URL and port. |

A test only proves the server can start on your machine. Each app still starts the server itself, with its own environment. See [Troubleshooting](./troubleshooting) if a server works in Kumi but not in an app.
