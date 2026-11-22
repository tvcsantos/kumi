import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostOf,
  KUMI_META_KEY,
  matchHost,
  normalizePattern,
  parseIp,
  patternError,
  privateNetworkFor,
  PUBLISHER_META_KEY,
  registryPrivateNetwork,
  type PrivateNetworkSettings,
} from '@shared/private-network';
import { FileRegistry } from '../src/main/catalog/file';
import { HttpCache } from '../src/main/catalog/http';
import { withRegistryMeta } from '../src/main/catalog/registry';
import { testServer } from '../src/main/health/check';
import { causeOf, errorCode } from '../src/main/health/network';

const settings = (patterns: PrivateNetworkSettings['privateNetworks'] = [], builtIns = true): PrivateNetworkSettings => ({
  privateNetworks: patterns,
  privateNetworkBuiltIns: builtIns,
});

describe('patterns', () => {
  it('accepts hosts, leading wildcards, addresses and ranges', () => {
    for (const p of ['mcp.acme.com', '*.acme.com', 'mcp', '10.42.0.0/16', '10.1.2.3', 'fd12::/16', '[fd12::1]', '::1']) expect(patternError(p), p).toBeUndefined();
  });

  it('rejects wildcards in the middle, bad names and bad ranges', () => {
    expect(patternError('mcp.*.acme.com')).toMatch(/only at the start/);
    expect(patternError('acme_corp.com')).toMatch(/host name/);
    expect(patternError('10.0.0.0/33')).toMatch(/IP/);
    expect(patternError('300.1.1.1')).toMatch(/host name|IP/);
    expect(patternError('  ')).toMatch(/Enter/);
  });

  it('normalizes case, brackets and a trailing dot', () => {
    expect(normalizePattern(' *.ACME.com. ')).toBe('*.acme.com');
    expect(normalizePattern('[FD12::]/16')).toBe('fd12::/16');
  });

  it('parses IPv4, IPv6 and IPv4-mapped addresses', () => {
    expect(parseIp('10.0.0.1')).toEqual({ v: 4, n: 0x0a000001n });
    expect(parseIp('fd00::1')?.v).toBe(6);
    expect(parseIp('::ffff:10.0.0.1')).toEqual({ v: 4, n: 0x0a000001n });
    expect(parseIp('1:2:3:4:5:6:7:8:9')).toBeUndefined();
    expect(parseIp('mcp.acme.com')).toBeUndefined();
  });
});

describe('matchHost', () => {
  it('matches the user patterns first, with their VPN name', () => {
    const s = settings([{ pattern: '*.acme.com', vpn: 'Acme GlobalProtect' }, { pattern: 'tools.example.org' }]);
    expect(matchHost('mcp.acme.com', s)).toEqual({ source: 'pattern', pattern: '*.acme.com', vpn: 'Acme GlobalProtect' });
    expect(matchHost('a.b.acme.com', s)?.pattern).toBe('*.acme.com');
    expect(matchHost('acme.com', s)).toBeUndefined();
    expect(matchHost('notacme.com', s)).toBeUndefined();
    expect(matchHost('tools.example.org', s)).toEqual({ source: 'pattern', pattern: 'tools.example.org' });
  });

  it('matches address ranges against an IP in the URL, or the resolved address', () => {
    const s = settings([{ pattern: '10.42.0.0/16', vpn: 'Lab' }], false);
    expect(matchHost('10.42.7.1', s)?.vpn).toBe('Lab');
    expect(matchHost('10.43.0.1', s)).toBeUndefined();
    expect(matchHost('mcp.acme.com', s)).toBeUndefined();
    expect(matchHost('mcp.acme.com', s, '10.42.0.9')?.vpn).toBe('Lab');
  });

  it('has built-ins for names and ranges that can only be private', () => {
    const s = settings();
    expect(matchHost('mcp', s)).toMatchObject({ source: 'built-in', pattern: 'single-label names' });
    expect(matchHost('localhost', s)).toBeUndefined();
    expect(matchHost('mcp.acme.internal', s)?.pattern).toBe('*.internal');
    expect(matchHost('printer.local', s)?.pattern).toBe('*.local');
    expect(matchHost('192.168.1.10', s)?.pattern).toBe('192.168.0.0/16');
    expect(matchHost('100.101.102.103', s)?.pattern).toBe('100.64.0.0/10');
    expect(matchHost('fd7a:115c::1', s)?.pattern).toBe('fc00::/7');
    expect(matchHost('127.0.0.1', s)).toBeUndefined();
    expect(matchHost('8.8.8.8', s)).toBeUndefined();
    expect(matchHost('mcp.acme.com', s)).toBeUndefined();
  });

  it('skips the built-ins when they are turned off', () => {
    expect(matchHost('mcp.acme.internal', settings([], false))).toBeUndefined();
  });

  it('reads hosts from URLs, and skips URL templates', () => {
    expect(hostOf('https://MCP.Acme.com./x')).toBe('mcp.acme.com');
    expect(hostOf('http://[fd00::1]:8080/mcp')).toBe('fd00::1');
    expect(hostOf('https://{tenant}.acme.com/mcp')).toBeUndefined();
    expect(hostOf('https://mcp.acme.com/{path}')).toBe('mcp.acme.com');
    expect(hostOf('not a url')).toBeUndefined();
  });
});

describe('registry flag', () => {
  const flag = (value: unknown) => ({ [KUMI_META_KEY]: value });

  it('reads the publisher flag inside publisher-provided', () => {
    expect(registryPrivateNetwork({ _meta: { [PUBLISHER_META_KEY]: flag({ private: true, vpn: 'Acme GlobalProtect' }) } })).toEqual({ vpn: 'Acme GlobalProtect' });
    // Directly in the server's _meta isn't where the official registry keeps it.
    expect(registryPrivateNetwork({ _meta: flag({ private: true }) })).toBeUndefined();
  });

  it("reads the registry operator's flag, whose VPN name wins", () => {
    expect(registryPrivateNetwork({ registryMeta: flag({ private: true }) })).toEqual({});
    expect(
      registryPrivateNetwork({
        _meta: { [PUBLISHER_META_KEY]: flag({ private: true, vpn: 'Acme VPN' }) },
        registryMeta: flag({ private: true, vpn: 'Acme VPN (EU gateway)' }),
      }),
    ).toEqual({ vpn: 'Acme VPN (EU gateway)' });
  });

  it('ignores anything but private: true', () => {
    expect(registryPrivateNetwork({ registryMeta: flag({ private: 'yes' }) })).toBeUndefined();
    expect(registryPrivateNetwork({ registryMeta: flag(true) })).toBeUndefined();
    expect(registryPrivateNetwork({ registryMeta: flag({ private: true, vpn: '  ' }) })).toEqual({});
  });

  it('comes before the patterns', () => {
    const s = settings([{ pattern: '*.acme.com', vpn: 'Pattern VPN' }]);
    expect(privateNetworkFor({ vpn: 'Registry VPN' }, ['https://mcp.acme.com'], s)).toEqual({ source: 'registry', vpn: 'Registry VPN' });
    expect(privateNetworkFor(undefined, [undefined, 'https://mcp.acme.com'], s)?.vpn).toBe('Pattern VPN');
    expect(privateNetworkFor(undefined, ['https://mcp.acme.com'], undefined)).toBeUndefined();
  });
});

describe('registries keep their own _meta', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'kumi-private-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('carries the _meta next to server into registryMeta', async () => {
    const path = join(root, 'servers.json');
    const meta = { 'io.modelcontextprotocol.registry/official': { isLatest: true }, [KUMI_META_KEY]: { private: true, vpn: 'Acme VPN' } };
    await fs.writeFile(path, JSON.stringify({ servers: [{ server: { name: 'acme/tickets', version: '1.0.0' }, _meta: meta }] }));
    const reg = new FileRegistry(new HttpCache(root), path);
    const [found] = (await reg.search('')).servers;
    expect(found.registryMeta).toEqual(meta);
    expect(registryPrivateNetwork(found)).toEqual({ vpn: 'Acme VPN' });
    expect(registryPrivateNetwork(await reg.get('acme/tickets', '1.0.0'))).toEqual({ vpn: 'Acme VPN' });
  });

  it('leaves servers without registry _meta as they are', () => {
    const server = { name: 'acme/tickets', version: '1.0.0' };
    expect(withRegistryMeta({ server })).toBe(server);
    expect(withRegistryMeta({ server, _meta: {} })).toBe(server);
  });
});

describe('network causes', () => {
  it('finds the system error code down the cause chain', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }) });
    expect(errorCode(e)).toBe('ENOTFOUND');
    expect(errorCode(new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]))).toBe('ECONNREFUSED');
    expect(errorCode(new Error('plain'))).toBeUndefined();
  });

  it('sorts codes into causes', () => {
    expect(causeOf('ENOTFOUND')).toBe('dns');
    expect(causeOf('UND_ERR_CONNECT_TIMEOUT')).toBe('timeout');
    expect(causeOf('EHOSTUNREACH')).toBe('route');
    expect(causeOf('ECONNREFUSED')).toBe('refused');
    expect(causeOf('CERT_HAS_EXPIRED')).toBe('tls');
    expect(causeOf('ERR_INVALID_URL')).toBeUndefined();
  });
});

describe('testServer on an unreachable server', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const remote = (url: string, transport: 'streamable-http' | 'sse' = 'streamable-http') => ({ name: 'acme', transport, url });

  it("says the name doesn't resolve, and that it's not reachable from here", async () => {
    // .invalid never resolves (RFC 6761).
    const r = await testServer(remote('https://mcp.kumi-test.invalid/mcp'));
    expect(r.ok).toBe(false);
    expect(r.unreachable).toEqual({ cause: 'dns', host: 'mcp.kumi-test.invalid' });
    expect(r.error).toMatch(/Couldn't find mcp\.kumi-test\.invalid: the name doesn't resolve/);
    expect(r.privateNetwork).toBeUndefined();
  });

  it('finds the cause for SSE too, where the transport drops it', async () => {
    const r = await testServer(remote('https://mcp.kumi-test.invalid/sse', 'sse'));
    expect(r.unreachable?.cause).toBe('dns');
  });

  it('names the private network when a pattern matches', async () => {
    const r = await testServer(remote('https://mcp.kumi-test.invalid/mcp'), { networks: settings([{ pattern: '*.kumi-test.invalid', vpn: 'Acme VPN' }]) });
    expect(r.privateNetwork).toEqual({ source: 'pattern', pattern: '*.kumi-test.invalid', vpn: 'Acme VPN' });
  });

  it("uses the registry's flag, for local servers too", async () => {
    const r = await testServer({ name: 'acme', transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(1)'] }, { privateNetwork: { vpn: 'Acme VPN' } });
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBeUndefined();
    expect(r.privateNetwork).toEqual({ source: 'registry', vpn: 'Acme VPN' });
  });

  it('reports a refused connection as an error, not as unreachable', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const r = await testServer(remote(`http://127.0.0.1:${port}/mcp`));
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBeUndefined();
    expect(r.error).toMatch(/refused the connection/);
  });
});

describe('describeCause', () => {
  it("gives a TLS failure's reason instead of fetch failed", async () => {
    const { describeCause } = await import('../src/main/health/network');
    const ssl = Object.assign(new Error('00D3CF0302000000:error:0A000458:SSL routines:ssl3_read_bytes:tlsv1 unrecognized name'), { code: 'ERR_SSL_TLSV1_UNRECOGNIZED_NAME' });
    expect(describeCause('tls', 'mcp.acme.com', ssl)).toBe('The secure connection to mcp.acme.com failed (ERR_SSL_TLSV1_UNRECOGNIZED_NAME)');
    const cert = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    expect(describeCause('tls', 'mcp.acme.com', cert)).toBe('The secure connection to mcp.acme.com failed: certificate has expired');
  });
});
