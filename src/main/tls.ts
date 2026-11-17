// Node only trusts its bundled Mozilla CA list, so servers signed by a corporate or internal CA fail with
// "unable to get local issuer certificate" even though the OS trusts them. Trust what the OS trusts too.

import { readFileSync } from 'node:fs';
import tls from 'node:tls';

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * Where Linux distros keep the system bundle, including CAs added with `update-ca-certificates` or `update-ca-trust`.
 * Electron's TLS library may not look here, so read the first one that exists ourselves.
 */
const LINUX_BUNDLES = [
  '/etc/ssl/certs/ca-certificates.crt', // Debian, Ubuntu, Arch, Gentoo
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem', // Fedora, RHEL, CentOS
  '/etc/pki/tls/certs/ca-bundle.crt', // older Fedora, RHEL
  '/etc/ssl/ca-bundle.pem', // openSUSE
  '/etc/ssl/cert.pem', // Alpine
];

/** The certificates in a PEM bundle, or none if it can't be read. */
function readPemFile(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').match(PEM) ?? [];
  } catch {
    return [];
  }
}

export interface TrustOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** The OS trust store; the macOS Keychain, the Windows certificate store, or OpenSSL's default paths elsewhere. */
  systemCerts?: () => string[];
}

/** Every certificate to trust: Node's own, the OS's, and the bundles named by the environment. */
export function trustedCertificates({ env = process.env, platform = process.platform, systemCerts = () => tls.getCACertificates('system') }: TrustOptions = {}): string[] {
  // Key by the base64 body, so one certificate found in two places with different line endings is added once.
  const certs = new Map<string, string>();
  const add = (list: string[]) => {
    for (const c of list) certs.set(c.replace(/\s+/g, ''), c);
  };
  add(tls.getCACertificates('default'));
  try {
    add(systemCerts());
  } catch {
    // no readable system store: keep the rest
  }
  if (platform === 'linux') {
    for (const path of LINUX_BUNDLES) {
      const bundle = readPemFile(path);
      if (bundle.length) {
        add(bundle);
        break;
      }
    }
  }
  // NODE_EXTRA_CA_CERTS is Node's own variable; SSL_CERT_FILE is OpenSSL's, used by Python, curl and Linux setups.
  for (const name of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
    const path = env[name];
    if (path) add(readPemFile(path));
  }
  return [...certs.values()];
}

/**
 * Makes every TLS connection in this process (`fetch`, the registry client, the MCP SDK's remote transports and OAuth
 * discovery) trust the OS trust store and the user's CA bundles, on top of Node's bundled list.
 *
 * Call it after the login shell's environment is loaded: Node reads `NODE_EXTRA_CA_CERTS` only at startup, and an
 * app opened from the Dock or a desktop launcher doesn't have it then.
 */
export function trustSystemCertificates(opts?: TrustOptions): void {
  tls.setDefaultCACertificates(trustedCertificates(opts));
}
