// Why a remote server couldn't be reached. fetch only says "fetch failed"; the system error is buried in `cause`.
// When it isn't there (the SSE transport drops it, or Kumi's own timeout fired), a quick DNS lookup and TCP connect
// find it out.

import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';

export type NetworkCause = 'dns' | 'timeout' | 'route' | 'refused' | 'reset' | 'tls';

const CAUSES: Record<string, NetworkCause> = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  EAI_NONAME: 'dns',
  ETIMEDOUT: 'timeout',
  UND_ERR_CONNECT_TIMEOUT: 'timeout',
  EHOSTUNREACH: 'route',
  ENETUNREACH: 'route',
  EHOSTDOWN: 'route',
  ENETDOWN: 'route',
  EADDRNOTAVAIL: 'route',
  ECONNREFUSED: 'refused',
  ECONNRESET: 'reset',
  UND_ERR_SOCKET: 'reset',
  EPIPE: 'reset',
};

const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_|ERR_OSSL_)/;

/** The error in an error's `cause` chain (or an AggregateError's errors) that carries the system code. */
export function codedError(e: unknown, depth = 0): Error | undefined {
  if (!e || typeof e !== 'object' || depth > 5) return undefined;
  if (e instanceof Error && typeof (e as { code?: unknown }).code === 'string') return e;
  for (const inner of (e as { errors?: unknown }).errors instanceof Array ? (e as { errors: unknown[] }).errors : []) {
    const c = codedError(inner, depth + 1);
    if (c) return c;
  }
  return codedError((e as { cause?: unknown }).cause, depth + 1);
}

/** The first system error code in an error's `cause` chain (or an AggregateError's errors). */
export function errorCode(e: unknown, depth = 0): string | undefined {
  if (!e || typeof e !== 'object' || depth > 5) return undefined;
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && code) return code;
  for (const inner of (e as { errors?: unknown }).errors instanceof Array ? (e as { errors: unknown[] }).errors : []) {
    const c = errorCode(inner, depth + 1);
    if (c) return c;
  }
  return errorCode((e as { cause?: unknown }).cause, depth + 1);
}

export function causeOf(code: string | undefined): NetworkCause | undefined {
  if (!code) return undefined;
  return CAUSES[code] ?? (TLS_CODE.test(code) ? 'tls' : undefined);
}

export interface ProbeResult {
  cause?: NetworkCause;
  /** The address the name resolved to, when it did. */
  address?: string;
}

/** Looks the host up and opens a TCP connection to it. No cause means it answered. */
export async function probe(url: URL, timeoutMs = 5000): Promise<ProbeResult> {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  let address: string;
  try {
    address = (await lookup(host)).address;
  } catch (e) {
    return { cause: causeOf(errorCode(e)) ?? 'dns' };
  }
  const cause = await new Promise<NetworkCause | undefined>((resolve) => {
    const socket = connect({ host: address, port });
    const done = (c: NetworkCause | undefined) => {
      socket.destroy();
      resolve(c);
    };
    socket.setTimeout(timeoutMs, () => done('timeout'));
    socket.once('connect', () => done(undefined));
    socket.once('error', (e) => done(causeOf(errorCode(e)) ?? 'route'));
  });
  return { cause, address };
}

/** The address a name resolves to, for matching address ranges; undefined when it doesn't resolve. */
export async function resolveAddress(host: string): Promise<string | undefined> {
  try {
    return (await lookup(host.replace(/^\[(.*)\]$/, '$1'))).address;
  } catch {
    return undefined;
  }
}

/** What happened, in words, for the causes whose system message says little. */
export function describeCause(cause: NetworkCause, host: string, inner?: Error): string | undefined {
  switch (cause) {
    case 'dns':
      return `Couldn't find ${host}: the name doesn't resolve`;
    case 'timeout':
      return `${host} didn't answer`;
    case 'route':
      return `There's no network route to ${host}`;
    case 'refused':
      return `${host} refused the connection. Check the URL and port`;
    case 'reset':
      return `${host} closed the connection`;
    case 'tls': {
      // Certificate errors read well ("certificate has expired"); OpenSSL's own don't, so give its code instead.
      const code = (inner as { code?: string } | undefined)?.code;
      if (inner && !/SSL routines|^[0-9A-F]{8,}:error:/.test(inner.message)) return `The secure connection to ${host} failed: ${inner.message}`;
      return `The secure connection to ${host} failed${code ? ` (${code})` : ''}`;
    }
  }
}

/** The causes that mean "not reachable from this network", rather than a broken server. */
export const isUnreachable = (c: NetworkCause | undefined): c is 'dns' | 'timeout' | 'route' => c === 'dns' || c === 'timeout' || c === 'route';
