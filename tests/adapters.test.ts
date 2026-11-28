import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerSpec } from '@shared/types';
import { ADAPTERS, getAdapter } from '../src/main/clients';
import { parseJson } from '../src/main/config-io/json';
import { parseToml } from '../src/main/config-io/toml';
import { parseYaml } from '../src/main/config-io/yaml';

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

  // Hermes resolves npx through PATHEXT itself, so it keeps the plain command (see its own test).
  it.skipIf(adapter.id === 'hermes')('wraps npx with cmd /c on Windows', () => {
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
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe(join('/repo', '.mcp.json'));
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

  it('keeps CRLF line endings when the existing file uses them', () => {
    const before = fixture('codex.toml').replace(/\n/g, '\r\n');
    const { text } = adapter.upsert(before, stdio, user, mac);
    expect(text.startsWith(before)).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(adapter.remove(text, 'context7', user)).toBe(before);
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
    expect(adapter.configPath(env, user)).toBe(join('/h/.config', 'opencode', 'opencode.json'));
    expect(adapter.configPath(env, { kind: 'project', projectDir: '/repo' })).toBe(join('/repo', 'opencode.json'));
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
    expect(adapter.configPath({ home: '/h', vars: {} } as never, user)).toBe(join('/h', '.pi', 'agent', 'mcp.json'));
    expect(adapter.configPath({ home: '/h', vars: { PI_CODING_AGENT_DIR: '/pi' } } as never, user)).toBe(join('/pi', 'mcp.json'));
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe(join('/repo', '.pi', 'mcp.json'));
  });
});

describe('junie', () => {
  const adapter = getAdapter('junie');

  it('writes plain mcpServers entries without a type', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect((parseJson(text) as { mcpServers: Record<string, unknown> }).mcpServers.remote).toEqual({ url: remote.url, headers: remote.headers });
  });

  it('bridges SSE servers', () => {
    const { warnings } = adapter.upsert('', { ...remote, transport: 'sse' }, user, mac);
    expect(warnings[0]).toMatch(/mcp-remote/);
  });

  it('uses ~/.junie/mcp/mcp.json and .junie/mcp/mcp.json in the project', () => {
    expect(adapter.configPath({ home: '/h', vars: {} } as never, user)).toBe(join('/h', '.junie', 'mcp', 'mcp.json'));
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe(join('/repo', '.junie', 'mcp', 'mcp.json'));
  });
});

describe('jetbrains-air', () => {
  const adapter = getAdapter('jetbrains-air');

  it('writes plain mcpServers entries without a type', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect((parseJson(text) as { mcpServers: Record<string, unknown> }).mcpServers.remote).toEqual({ url: remote.url, headers: remote.headers });
  });

  it('bridges SSE servers, which Air in IDEs rejects', () => {
    const { warnings } = adapter.upsert('', { ...remote, transport: 'sse' }, user, mac);
    expect(warnings[0]).toMatch(/mcp-remote/);
  });

  it('uses the global ~/.jetbrains/mcp/mcp.json only', () => {
    expect(adapter.configPath({ home: '/h', vars: {} } as never, user)).toBe(join('/h', '.jetbrains', 'mcp', 'mcp.json'));
    expect(adapter.scopes).toEqual(['user']);
  });
});

describe('zed', () => {
  const adapter = getAdapter('zed');

  it('writes plain context_servers entries without a type', () => {
    const { text } = adapter.upsert('', remote, user, mac);
    expect((parseJson(text) as { context_servers: Record<string, unknown> }).context_servers.remote).toEqual({ url: remote.url, headers: remote.headers });
  });

  it('leaves the rest of settings.json, comments included, untouched', () => {
    const settings = '{\n  // my theme\n  "theme": "One Dark",\n  "context_servers": {}\n}\n';
    const { text } = adapter.upsert(settings, stdio, user, mac);
    expect(text).toContain('// my theme');
    expect(text).toContain('"theme": "One Dark"');
    expect(adapter.readServers(text, user).context7).toMatchObject({ command: 'npx' });
  });

  it('bridges SSE servers', () => {
    const { warnings } = adapter.upsert('', { ...remote, transport: 'sse' }, user, mac);
    expect(warnings[0]).toMatch(/mcp-remote/);
  });

  it('uses ~/.config/zed, %APPDATA%\\Zed and .zed/settings.json in the project', () => {
    expect(adapter.configPath({ home: '/h', platform: 'darwin', xdgConfig: '/x', vars: {} } as never, user)).toBe(join('/h', '.config', 'zed', 'settings.json'));
    expect(adapter.configPath({ home: '/h', platform: 'linux', xdgConfig: '/x', vars: {} } as never, user)).toBe(join('/x', 'zed', 'settings.json'));
    expect(adapter.configPath({ home: '/h', platform: 'win32', appData: '/a', vars: {} } as never, user)).toBe(join('/a', 'Zed', 'settings.json'));
    expect(adapter.configPath({ home: '/h', vars: {} } as never, { kind: 'project', projectDir: '/repo' })).toBe(join('/repo', '.zed', 'settings.json'));
  });
});

describe('cline', () => {
  const adapter = getAdapter('cline');
  type Settings = { mcpServers: Record<string, unknown>; someOtherSetting?: boolean };

  it('always writes a type, since Cline reads a bare url as SSE', () => {
    const http = parseJson(adapter.upsert('', remote, user, mac).text) as Settings;
    expect(http.mcpServers.remote).toEqual({ type: 'streamableHttp', url: remote.url, headers: remote.headers });
    const sse = parseJson(adapter.upsert('', { ...remote, transport: 'sse' }, user, mac).text) as Settings;
    expect(sse.mcpServers.remote).toMatchObject({ type: 'sse', url: remote.url });
    const local = parseJson(adapter.upsert('', stdio, user, mac).text) as Settings;
    expect(local.mcpServers.context7).toEqual({ type: 'stdio', command: 'npx', args: stdio.args, env: stdio.env });
  });

  it('reads legacy, aliased and nested entries the way Cline does', () => {
    const servers = adapter.readServers(fixture('cline_mcp_settings.json'), user);
    expect(servers['legacy-sse']).toMatchObject({ transport: 'sse', url: 'https://legacy.example.com/sse' });
    expect(servers['http-alias']).toMatchObject({ transport: 'streamable-http', url: 'https://alias.example.com/mcp' });
    expect(servers.nested).toMatchObject({ transport: 'streamable-http', url: 'https://nested.example.com/mcp', headers: { 'X-Team': 'core' } });
    expect(servers.fs).toMatchObject({ transport: 'stdio', command: 'npx' });
  });

  it('keeps other servers and settings on install and remove', () => {
    const before = fixture('cline_mcp_settings.json');
    const { text } = adapter.upsert(before, stdio, user, mac);
    const json = parseJson(text) as Settings;
    expect(json.someOtherSetting).toBe(true);
    expect(json.mcpServers.fs).toEqual((parseJson(before) as Settings).mcpServers.fs);
    expect(Object.keys(adapter.readServers(text, user))).toEqual(['legacy-sse', 'http-alias', 'nested', 'fs', 'context7']);
    expect(parseJson(adapter.remove(text, 'context7', user))).toEqual(parseJson(before));
  });

  it('uses ~/.cline/data/settings and follows the Cline env vars', () => {
    const file = 'cline_mcp_settings.json';
    expect(adapter.configPath({ home: '/h', vars: {} } as never, user)).toBe(join('/h', '.cline', 'data', 'settings', file));
    expect(adapter.configPath({ home: '/h', vars: { CLINE_DIR: '/c' } } as never, user)).toBe(join('/c', 'data', 'settings', file));
    expect(adapter.configPath({ home: '/h', vars: { CLINE_DIR: '/c', CLINE_DATA_DIR: '/d' } } as never, user)).toBe(join('/d', 'settings', file));
    expect(adapter.configPath({ home: '/h', vars: { CLINE_DATA_DIR: '/d', CLINE_MCP_SETTINGS_PATH: '/m.json' } } as never, user)).toBe('/m.json');
    expect(adapter.scopes).toEqual(['user']);
  });
});

describe('hermes', () => {
  const adapter = getAdapter('hermes');
  const env = (vars: Record<string, string> = {}, platform: NodeJS.Platform = 'darwin') =>
    ({ home: '/h', platform, localAppData: 'C:\\Users\\me\\AppData\\Local', vars }) as never;

  it('appends to mcp_servers and leaves the rest of the file byte-identical', () => {
    const before = fixture('hermes.yaml');
    const { text } = adapter.upsert(before, stdio, user, mac);
    const inserted = '    auth: oauth\n  context7:\n    command: "npx"\n    args: ["-y", "@upstash/context7-mcp@1.0.0"]\n    env:\n      CONTEXT7_API_KEY: "sk-1"\n';
    expect(text).toBe(before.replace('    auth: oauth\n', inserted));
    expect(Object.keys(adapter.readServers(text, user))).toEqual(['github', 'linear', 'context7']);
    expect(adapter.remove(text, 'context7', user)).toBe(before);
  });

  it('replaces an existing server in place, keeping the comment above the next one', () => {
    const before = fixture('hermes.yaml');
    const { text } = adapter.upsert(before, { ...remote, name: 'github' }, user, mac);
    expect(text).toContain('mcp_servers:\n  github:\n    url: "https://example.com/mcp"\n    headers:\n      Authorization: "Bearer t"\n\n  # Hosted\n  linear:');
    expect(text).not.toContain('rotate monthly');
    expect(parseYaml(text).terminal).toEqual({ backend: 'local' });
  });

  it('removes a server and the blank line before it', () => {
    const before = fixture('hermes.yaml');
    const text = adapter.remove(before, 'linear', user);
    expect(text).toContain('      include: [list_issues, create_issue]\n\n# Terminal backend');
    expect(Object.keys(adapter.readServers(text, user))).toEqual(['github']);
  });

  it('writes legacy SSE servers natively with transport: sse', () => {
    const { text, warnings } = adapter.upsert('model: x\n', { ...remote, transport: 'sse', headers: undefined }, user, mac);
    expect(warnings).toEqual([]);
    expect(text).toBe('model: x\n\nmcp_servers:\n  remote:\n    url: "https://example.com/mcp"\n    transport: "sse"\n');
    expect(adapter.readServers(text, user).remote).toEqual({ name: 'remote', transport: 'sse', url: 'https://example.com/mcp' });
  });

  it('drops mcp_servers once its last server is removed', () => {
    const { text } = adapter.upsert('model: x\n', stdio, user, mac);
    expect(adapter.remove(text, 'context7', user)).toBe('model: x\n');
  });

  it('keeps npx as is on Windows', () => {
    const { text } = adapter.upsert('', stdio, user, { ...mac, platform: 'win32' });
    expect(adapter.readServers(text, user).context7).toMatchObject({ command: 'npx', args: stdio.args });
  });

  it('keeps CRLF line endings', () => {
    const before = fixture('hermes.yaml').replace(/\n/g, '\r\n');
    const { text } = adapter.upsert(before, stdio, user, mac);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(adapter.remove(text, 'context7', user)).toBe(before);
  });

  it('uses ~/.hermes, %LOCALAPPDATA%\\hermes on Windows, or $HERMES_HOME', () => {
    expect(adapter.configPath(env(), user)).toBe(join('/h', '.hermes', 'config.yaml'));
    expect(adapter.configPath(env({}, 'win32'), user)).toBe(join('C:\\Users\\me\\AppData\\Local', 'hermes', 'config.yaml'));
    expect(adapter.configPath(env({ HERMES_HOME: '/srv/hermes' }), user)).toBe(join('/srv/hermes', 'config.yaml'));
    expect(adapter.configPath(env({ HERMES_HOME: '~/alt' }), user)).toBe(join('/h/alt', 'config.yaml'));
  });
});
