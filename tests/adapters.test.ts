import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerSpec } from '@shared/types';
import { ADAPTERS, getAdapter } from '../src/main/clients';
import { parseJson } from '../src/main/config-io/json';
import { parseToml } from '../src/main/config-io/toml';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/configs', name), 'utf8');
const mac = { secretsMode: 'inline', platform: 'darwin' } as const;
const user = { kind: 'user' } as const;

const stdio: ServerSpec = {
  name: 'context7',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@upstash/context7-mcp@1.0.0'],
  env: { CONTEXT7_API_KEY: 'sk-1' },
  secretEnv: ['CONTEXT7_API_KEY'],
};
const remote: ServerSpec = {
  name: 'remote',
  transport: 'streamable-http',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer t' },
  secretHeaders: ['Authorization'],
};

describe.each(ADAPTERS.map((a) => [a.id, a] as const))('%s adapter', (_id, adapter) => {
  it('round-trips a stdio server into an empty config', () => {
    const { text } = adapter.upsert('', stdio, user, mac);
    const read = adapter.readServers(text, user).context7;
    expect(read).toMatchObject({ transport: 'stdio', command: 'npx', args: stdio.args, env: stdio.env });
    expect(adapter.remove(text, 'context7', user)).not.toContain('context7');
  });

  it('handles remote servers natively or through the bridge', () => {
    const { text, warnings } = adapter.upsert('', remote, user, mac);
    const read = adapter.readServers(text, user).remote;
    if (adapter.transports.includes('streamable-http')) {
      expect(read).toMatchObject({ transport: 'streamable-http', url: remote.url, headers: remote.headers });
      expect(warnings).toEqual([]);
    } else {
      expect(read.command).toBe('npx');
      expect(read.args).toContain('mcp-remote');
      expect(warnings[0]).toMatch(/mcp-remote/);
    }
  });

  it('wraps npx with cmd /c on Windows', () => {
    const { text } = adapter.upsert('', stdio, user, { ...mac, platform: 'win32' });
    expect(adapter.readServers(text, user).context7).toMatchObject({ command: 'cmd', args: ['/c', 'npx', ...stdio.args!] });
  });
});

describe('claude-code', () => {
  const adapter = getAdapter('claude-code');

  it('writes user scope at the top level and keeps unrelated state', () => {
    const before = fixture('claude.json');
    const { text } = adapter.upsert(before, remote, user, mac);
    const json = parseJson(text) as { numStartups: number; mcpServers: Record<string, unknown> };
    expect(json.numStartups).toBe(42);
    expect(json.mcpServers.remote).toEqual({ type: 'http', url: remote.url, headers: remote.headers });
    expect(Object.keys(adapter.readServers(text, user))).toEqual(['existing', 'remote']);
  });

  it('writes local scope under projects[dir]', () => {
    const scope = { kind: 'local', projectDir: '/Users/me/other' } as const;
    const { text } = adapter.upsert(fixture('claude.json'), stdio, scope, mac);
    const json = parseJson(text) as { projects: Record<string, { mcpServers?: Record<string, unknown> }> };
    expect(json.projects['/Users/me/other'].mcpServers?.context7).toBeDefined();
    expect(json.projects['/Users/me/app']).toEqual({ allowedTools: [], mcpServers: {} });
    expect(adapter.readServers(text, user).context7).toBeUndefined();
  });

  it('uses .mcp.json for project scope', () => {
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe('/repo/.mcp.json');
  });
});

describe('vscode', () => {
  const adapter = getAdapter('vscode');

  it('keeps comments, other servers and user inputs', () => {
    const { text } = adapter.upsert(fixture('vscode-user.jsonc'), stdio, user, mac);
    expect(text).toContain('// My MCP servers');
    expect(Object.keys(adapter.readServers(text, user))).toEqual(['memory', 'context7']);
    expect(text).toContain('"my-key"');
  });

  it('uses VS Code inputs for secrets in client-native mode, and cleans them up', () => {
    const { text } = adapter.upsert(fixture('vscode-user.jsonc'), stdio, user, { ...mac, secretsMode: 'client-native' });
    expect(text).not.toContain('sk-1');
    const json = parseJson(text) as { inputs: { id: string; password?: boolean }[]; servers: Record<string, { env: Record<string, string> }> };
    expect(json.servers.context7.env.CONTEXT7_API_KEY).toBe('${input:kumi.context7.CONTEXT7_API_KEY}');
    expect(json.inputs.map((i) => i.id)).toEqual(['my-key', 'kumi.context7.CONTEXT7_API_KEY']);

    const removed = parseJson(adapter.remove(text, 'context7', user)) as { inputs: { id: string }[] };
    expect(removed.inputs.map((i) => i.id)).toEqual(['my-key']);
  });

  it('does not duplicate inputs when re-installing', () => {
    const native = { ...mac, secretsMode: 'client-native' } as const;
    const once = adapter.upsert('', stdio, user, native).text;
    const twice = adapter.upsert(once, stdio, user, native).text;
    expect((parseJson(twice) as { inputs: unknown[] }).inputs).toHaveLength(1);
  });
});

describe('codex', () => {
  const adapter = getAdapter('codex');

  it('appends a section and leaves the rest byte-identical', () => {
    const before = fixture('codex.toml');
    const { text } = adapter.upsert(before, stdio, user, mac);
    expect(text.startsWith(before)).toBe(true);
    expect(text.slice(before.length)).toBe(
      '\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp@1.0.0"]\n\n[mcp_servers.context7.env]\nCONTEXT7_API_KEY = "sk-1"\n',
    );
    expect(adapter.remove(text, 'context7', user)).toBe(before);
  });

  it('replaces an existing server in place of its old sections', () => {
    const { text } = adapter.upsert(fixture('codex.toml'), { ...stdio, name: 'existing' }, user, mac);
    const parsed = parseToml(text) as { profiles: unknown; mcp_servers: Record<string, { env: unknown }> };
    expect(parsed.mcp_servers.existing.env).toEqual({ CONTEXT7_API_KEY: 'sk-1' });
    expect(parsed.profiles).toEqual({ fast: { model: 'gpt-5-mini' } });
    expect(text).toContain('# Profiles below\n[profiles.fast]');
  });

  it('maps remote headers to http_headers', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect(text).toBe('[mcp_servers.remote]\nurl = "https://example.com/mcp"\n\n[mcp_servers.remote.http_headers]\nAuthorization = "Bearer t"\n');
  });
});

describe('copilot-cli', () => {
  it('uses the local type and enables all tools', () => {
    const { text } = getAdapter('copilot-cli').upsert('', stdio, user, mac);
    expect((parseJson(text) as { mcpServers: Record<string, unknown> }).mcpServers.context7).toMatchObject({ type: 'local', tools: ['*'] });
  });
});

describe('opencode', () => {
  const adapter = getAdapter('opencode');

  it('writes a local server as a command array under mcp.servers, keeping comments and other servers', () => {
    const { text } = adapter.upsert(fixture('opencode.jsonc'), stdio, user, mac);
    expect(text).toContain('// Theme and model');
    const json = parseJson(text) as { model: string; mcp: { servers: Record<string, unknown> } };
    expect(json.model).toBe('anthropic/claude-sonnet-5-5');
    expect(json.mcp.servers.context7).toEqual({
      type: 'local',
      command: ['npx', '-y', '@upstash/context7-mcp@1.0.0'],
      environment: { CONTEXT7_API_KEY: 'sk-1' },
    });
    expect(adapter.readServers(text, user).existing).toEqual({
      name: 'existing',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
      env: { LOG_LEVEL: 'info' },
    });
  });

  it('writes remote servers with the remote type', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect((parseJson(text) as { mcp: { servers: Record<string, unknown> } }).mcp.servers.remote).toEqual({
      type: 'remote',
      url: remote.url,
      headers: remote.headers,
    });
  });

  it('bridges SSE servers through mcp-remote', () => {
    const { text, warnings } = adapter.upsert('', { ...remote, transport: 'sse' }, user, mac);
    expect(adapter.readServers(text, user).remote).toMatchObject({ command: 'npx', transport: 'stdio' });
    expect(warnings[0]).toMatch(/mcp-remote/);
  });

  it('uses ~/.config/opencode for user scope and opencode.json in the project', () => {
    const env = { home: '/h', xdgConfig: '/h/.config', vars: {} } as never;
    expect(adapter.configPath(env, user)).toBe('/h/.config/opencode/opencode.json');
    expect(adapter.configPath(env, { kind: 'project', projectDir: '/repo' })).toBe('/repo/opencode.json');
  });
});

describe('pi', () => {
  const adapter = getAdapter('pi');

  it('writes plain mcpServers entries without a type', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect((parseJson(text) as { mcpServers: Record<string, unknown> }).mcpServers.remote).toEqual({ url: remote.url, headers: remote.headers });
  });

  it('bridges SSE servers, which Pi rejects', () => {
    const { warnings } = adapter.upsert('', { ...remote, transport: 'sse' }, user, mac);
    expect(warnings[0]).toMatch(/mcp-remote/);
  });

  it('uses the agent dir (honoring PI_CODING_AGENT_DIR) and .pi/mcp.json in the project', () => {
    expect(adapter.configPath({ home: '/h', vars: {} } as never, user)).toBe('/h/.pi/agent/mcp.json');
    expect(adapter.configPath({ home: '/h', vars: { PI_CODING_AGENT_DIR: '/pi' } } as never, user)).toBe('/pi/mcp.json');
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe('/repo/.pi/mcp.json');
  });
});
