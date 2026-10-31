// Curated overlay on top of the registry: featured servers and their categories.
// Names are official MCP Registry server names.

export interface FeaturedServer {
  name: string;
  category: string;
}

export const FEATURED: FeaturedServer[] = [
  { name: 'io.github.github/github-mcp-server', category: 'Developer tools' },
  { name: 'io.github.upstash/context7', category: 'Developer tools' },
  { name: 'io.github.microsoft/playwright-mcp', category: 'Browser automation' },
  { name: 'io.github.getsentry/sentry-mcp', category: 'Developer tools' },
  { name: 'com.notion/mcp', category: 'Productivity' },
  { name: 'app.linear/linear', category: 'Productivity' },
  { name: 'com.atlassian/atlassian-mcp-server', category: 'Productivity' },
  { name: 'com.figma.mcp/mcp', category: 'Design' },
  { name: 'com.stripe/mcp', category: 'Payments' },
  { name: 'com.supabase/mcp', category: 'Databases' },
];
