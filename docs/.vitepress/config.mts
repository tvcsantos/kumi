import { defineConfig } from 'vitepress';

const repo = 'https://github.com/tvcsantos/kumi';

// Served from GitHub Pages at https://tvcsantos.github.io/kumi/. Override with DOCS_BASE for another host.
const base = process.env.DOCS_BASE ?? '/kumi/';

export default defineConfig({
  title: 'Kumi',
  description: 'A desktop MCP marketplace: browse MCP servers and install them into Claude, VS Code, Cursor, Codex, Copilot, OpenCode and Pi.',
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#1A2240' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Kumi: a desktop MCP marketplace' }],
    ['meta', { property: 'og:description', content: 'Browse MCP servers and install them into every AI tool you use.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/what-is-kumi', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/apps', activeMatch: '/reference/' },
      { text: 'Contributing', link: '/contributing/development', activeMatch: '/contributing/' },
      { text: 'Download', link: `${repo}/releases/latest` },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Kumi?', link: '/guide/what-is-kumi' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'First run', link: '/guide/first-run' },
          ],
        },
        {
          text: 'Using Kumi',
          items: [
            { text: 'Discover servers', link: '/guide/discover' },
            { text: 'Install a server', link: '/guide/install' },
            { text: 'Custom servers', link: '/guide/custom-servers' },
            { text: 'Manage installed servers', link: '/guide/installed' },
            { text: 'Test a connection', link: '/guide/test-connection' },
          ],
        },
        {
          text: 'Configuration',
          items: [
            { text: 'Registries', link: '/guide/registries' },
            { text: 'Secrets', link: '/guide/secrets' },
            { text: 'Settings', link: '/guide/settings' },
          ],
        },
        {
          text: 'Trust',
          items: [
            { text: 'How Kumi edits configs', link: '/guide/safe-edits' },
            { text: 'Security', link: '/guide/security' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Supported apps', link: '/reference/apps' },
            { text: 'Registry file format', link: '/reference/registry-format' },
            { text: 'Data directory', link: '/reference/data-directory' },
            { text: 'Environment variables', link: '/reference/environment' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Development', link: '/contributing/development' },
            { text: 'Architecture', link: '/contributing/architecture' },
            { text: 'Adding an app', link: '/contributing/adding-an-app' },
            { text: 'Releasing', link: '/contributing/releasing' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Tiago Santos',
    },
  },
});
