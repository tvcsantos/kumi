import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trustedCertificates, trustSystemCertificates } from '../src/main/tls';

let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  hasOpenssl = false;
}

describe.skipIf(!hasOpenssl)('trustSystemCertificates', () => {
  let dir: string;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    // A server signed by a CA Node doesn't ship, like a corporate or internal one.
    dir = mkdtempSync(join(tmpdir(), 'kumi-tls-'));
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
    server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes fetch trust the NODE_EXTRA_CA_CERTS bundle loaded after startup', async () => {
    await expect(fetch(url)).rejects.toThrow();
    trustSystemCertificates({ env: { NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') } });
    const res = await fetch(url);
    expect(await res.text()).toBe('ok');
  });

  it('adds the OS store and SSL_CERT_FILE, once each', () => {
    const cert = readFileSync(join(dir, 'cert.pem'), 'utf8').trim();
    const body = (c: string) => c.replace(/\s+/g, '');
    const fromStore = trustedCertificates({ env: {}, platform: 'win32', systemCerts: () => [cert] });
    expect(fromStore.map(body)).toContain(body(cert));
    // Found in both the OS store (with Windows line endings) and SSL_CERT_FILE: trusted once.
    const both = trustedCertificates({
      env: { SSL_CERT_FILE: join(dir, 'cert.pem') },
      platform: 'win32',
      systemCerts: () => [cert.replace(/\n/g, '\r\n')],
    });
    expect(both.filter((c) => body(c) === body(cert))).toHaveLength(1);
  });

  it('survives a missing bundle and an unreadable system store', () => {
    const broken = () => {
      throw new Error('no store');
    };
    expect(() => trustedCertificates({ env: { NODE_EXTRA_CA_CERTS: join(dir, 'missing.pem') }, platform: 'linux', systemCerts: broken })).not.toThrow();
  });
});
