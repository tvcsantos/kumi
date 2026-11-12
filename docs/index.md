---
layout: home

hero:
  name: Kumi
  text: A desktop MCP marketplace
  tagline: Find MCP servers, fill in their settings once, and install them into every AI tool you use. Kumi writes the right config, in the right format and place, for each one.
  image:
    src: /logo.svg
    alt: Kumi
  actions:
    - theme: brand
      text: Get started
      link: /guide/what-is-kumi
    - theme: alt
      text: Download
      link: /guide/installation#download
    - theme: alt
      text: View on GitHub
      link: https://github.com/tvcsantos/kumi

features:
  - icon: 🔎
    title: One catalog, many registries
    details: Search the official MCP Registry and your own registries at once. Private registries can send a token; secret values are encrypted with the OS keychain.
  - icon: 🧩
    title: Eight apps, one install
    details: Claude Desktop, Claude Code, VS Code (Copilot), Cursor, OpenAI Codex, GitHub Copilot CLI, OpenCode and Pi. Pick several at once, each in the scope you want.
  - icon: 📝
    title: Forms from server.json
    details: Environment variables, arguments, headers and URL variables come from each server's metadata. Required fields, choices and defaults included; secrets are masked.
  - icon: 🔍
    title: Preview every edit
    details: See the exact diff for each config file before anything is written. Secrets are hidden in the preview.
  - icon: 🛟
    title: Safe by design
    details: Comments and unrelated settings are kept. Writes are atomic and backed up first, and a write is refused if the file changed or the edit would touch anything else.
  - icon: 🩺
    title: Test the connection
    details: Kumi starts the server (or connects to it), runs the MCP handshake and lists its tools, so you know it works before you open your app.
---

<div class="vp-doc" style="max-width: 1152px; margin: 48px auto 0; padding: 0 24px;">

![Kumi's Discover page: featured servers, with a filter for each registry](./screenshots/discover.png){.shot .light-only}
![Kumi's Discover page: featured servers, with a filter for each registry](./screenshots/discover-dark.png){.shot .dark-only}

</div>
