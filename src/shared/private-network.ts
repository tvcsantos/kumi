// Servers that only answer on a private network, such as a company VPN. Kumi learns that from the server's registry
// entry, or from host patterns in Settings, and uses it to explain failed tests and to warn before an install.

import type { RegistryServer } from './registry';

/** Kumi's key in a registry's `_meta` objects (reverse DNS of Kumi's docs domain, then the name). */
export const KUMI_META_KEY = 'pt.com.santos.tiago/kumi';
/** The only `_meta` key the official registry software keeps in a published `server.json`. */
export const PUBLISHER_META_KEY = 'io.modelcontextprotocol.registry/publisher-provided';

/** A host pattern from Settings: `*.acme.com`, `mcp.acme.com`, `10.42.0.0/16`, `fd12::/16`, or one address. */
export interface PrivateNetworkPattern {
  pattern: string;
  /** What to connect to, as people know it, e.g. "Acme GlobalProtect". */
  vpn?: string;
}

/** Why Kumi treats a server as being on a private network. */
export interface PrivateNetwork {
  /** `registry`: the server's registry entry says so. `pattern`: one of the user's patterns matched. `built-in`: a built-in one did. */
  source: 'registry' | 'pattern' | 'built-in';
  vpn?: string;
  /** The pattern that matched, for `pattern` and `built-in`. */
  pattern?: string;
}

export interface PrivateNetworkSettings {
  privateNetworks: PrivateNetworkPattern[];
  privateNetworkBuiltIns: boolean;
}

/** Names and ranges that can only be private, so the built-in list is never wrong. */
export const BUILT_IN_PATTERNS = ['*.internal', '*.local', '*.home.arpa', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7'] as const;
/** Shown for the rule that isn't a pattern: names without a dot, like `http://mcp:8080`. */
export const SINGLE_LABEL_RULE = 'single-label names';

const MAX_VPN = 100;

// ── Addresses ────────────────────────────────────────────────────────────────

type Ip = { v: 4; n: bigint } | { v: 6; n: bigint };

function parseIpv4(s: string): bigint | undefined {
  const parts = s.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return undefined;
    n = (n << 8n) | BigInt(Number(p));
  }
  return n;
}

function parseIpv6(s: string): bigint | undefined {
  if (!s.includes(':') || (s.match(/::/g)?.length ?? 0) > 1) return undefined;
  let groups: string[];
  let tail: bigint | undefined;
  const last = s.slice(s.lastIndexOf(':') + 1);
  if (last.includes('.')) {
    // An IPv4 tail, as in ::ffff:10.1.2.3
    tail = parseIpv4(last);
    if (tail === undefined) return undefined;
    s = s.slice(0, s.length - last.length) + '0:0';
  }
  if (s.includes('::')) {
    const [head, rest] = s.split('::');
    const h = head ? head.split(':') : [];
    const r = rest ? rest.split(':') : [];
    if (h.length + r.length > 7) return undefined;
    groups = [...h, ...Array<string>(8 - h.length - r.length).fill('0'), ...r];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return undefined;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return tail === undefined ? n : (n & ~0xffffffffn) | tail;
}

export function parseIp(s: string): Ip | undefined {
  const v4 = parseIpv4(s);
  if (v4 !== undefined) return { v: 4, n: v4 };
  const v6 = parseIpv6(s);
  if (v6 === undefined) return undefined;
  // An IPv4-mapped address (::ffff:a.b.c.d) is that IPv4 address.
  if (v6 >> 32n === 0xffffn) return { v: 4, n: v6 & 0xffffffffn };
  return { v: 6, n: v6 };
}

interface Cidr {
  v: 4 | 6;
  base: bigint;
  bits: number;
}

function parseCidr(s: string): Cidr | undefined {
  const [addr, len, extra] = s.split('/');
  if (extra !== undefined) return undefined;
  const ip = parseIp(addr);
  if (!ip) return undefined;
  const max = ip.v === 4 ? 32 : 128;
  if (len !== undefined && (!/^\d{1,3}$/.test(len) || Number(len) > max)) return undefined;
  const bits = len === undefined ? max : Number(len);
  return { v: ip.v, base: ip.n >> BigInt(max - bits), bits };
}

function inCidr(ip: Ip, c: Cidr): boolean {
  if (ip.v !== c.v) return false;
  return ip.n >> BigInt((c.v === 4 ? 32 : 128) - c.bits) === c.base;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const isHostName = (s: string) => s.split('.').every((l) => LABEL.test(l));

/** Lowercase, trimmed; a trailing dot and IPv6 brackets dropped. */
export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase().replace(/^\[(.*)\](\/\d+)?$/, '$1$2').replace(/\.$/, '');
}

/** Why a pattern can't be used, or undefined when it's fine. */
export function patternError(pattern: string): string | undefined {
  const p = normalizePattern(pattern);
  if (!p) return 'Enter a host name, a *.domain wildcard, or an IP range.';
  // All digits and dots is meant as an address, never a name.
  if (/[/:]/.test(p) || /^[\d.]+$/.test(p)) return parseCidr(p) ? undefined : 'Not a valid IP address or range, like 10.42.0.0/16.';
  const name = p.startsWith('*.') ? p.slice(2) : p;
  if (name.includes('*')) return 'Use * only at the start, as in *.acme.com.';
  if (!isHostName(name)) return 'Not a valid host name.';
  return undefined;
}

/** The host of a URL, as patterns see it: lowercase, without brackets or a trailing dot. Undefined for URL templates and bad URLs. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url || /[{}]/.test(url.split('/').slice(0, 3).join('/'))) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
    return host || undefined;
  } catch {
    return undefined;
  }
}

function patternMatches(pattern: string, host: string, ip: Ip | undefined): boolean {
  const p = normalizePattern(pattern);
  const cidr = /[/:]/.test(p) || parseIp(p) ? parseCidr(p) : undefined;
  if (cidr) return !!ip && inCidr(ip, cidr);
  if (parseIp(host)) return false;
  if (p.startsWith('*.')) return host.endsWith(p.slice(1));
  return host === p;
}

/**
 * Whether a host is on a private network according to the patterns in Settings. Address patterns match an IP in
 * the URL, or `resolved`: the address the name resolved to, when the caller looked it up. The user's own patterns
 * come first, so their VPN labels win.
 */
export function matchHost(host: string, settings: PrivateNetworkSettings, resolved?: string): PrivateNetwork | undefined {
  const ip = parseIp(host) ?? (resolved ? parseIp(resolved) : undefined);
  for (const p of settings.privateNetworks) {
    if (patternMatches(p.pattern, host, ip)) return { source: 'pattern', pattern: normalizePattern(p.pattern), ...(p.vpn ? { vpn: p.vpn } : {}) };
  }
  if (!settings.privateNetworkBuiltIns) return undefined;
  if (!parseIp(host) && !host.includes('.') && host !== 'localhost') return { source: 'built-in', pattern: SINGLE_LABEL_RULE };
  for (const p of BUILT_IN_PATTERNS) if (patternMatches(p, host, ip)) return { source: 'built-in', pattern: p };
  return undefined;
}

export function matchUrl(url: string | undefined, settings: PrivateNetworkSettings): PrivateNetwork | undefined {
  const host = hostOf(url);
  return host ? matchHost(host, settings) : undefined;
}

// ── Registry flag ────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function readFlag(value: unknown): { vpn?: string } | undefined {
  const o = obj(value);
  if (o?.private !== true) return undefined;
  const vpn = typeof o.vpn === 'string' ? o.vpn.trim().slice(0, MAX_VPN) : '';
  return vpn ? { vpn } : {};
}

/**
 * The registry's `private` flag for a server: from the registry operator (the `_meta` next to `server` in the
 * registry's answer) or from the publisher (`server.json`'s `_meta`, inside `publisher-provided`). Either marks the
 * server private; the operator's `vpn` label wins, since it's their network.
 */
export function registryPrivateNetwork(server: Pick<RegistryServer, '_meta' | 'registryMeta'>): { vpn?: string } | undefined {
  const operator = readFlag(server.registryMeta?.[KUMI_META_KEY]);
  const publisher = readFlag(obj(server._meta?.[PUBLISHER_META_KEY])?.[KUMI_META_KEY]);
  if (!operator && !publisher) return undefined;
  const vpn = operator?.vpn ?? publisher?.vpn;
  return vpn ? { vpn } : {};
}

/** Whether a server is on a private network: its registry flag first, then the patterns, against each URL given. */
export function privateNetworkFor(registry: { vpn?: string } | undefined, urls: (string | undefined)[], settings: PrivateNetworkSettings | undefined): PrivateNetwork | undefined {
  if (registry) return { source: 'registry', ...(registry.vpn ? { vpn: registry.vpn } : {}) };
  if (!settings) return undefined;
  for (const url of urls) {
    const m = matchUrl(url, settings);
    if (m) return m;
  }
  return undefined;
}

/** "Acme GlobalProtect", or "your VPN" when nobody named it. */
export const vpnName = (p: PrivateNetwork | undefined) => p?.vpn ?? 'your VPN';
