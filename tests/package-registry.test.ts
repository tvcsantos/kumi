import { describe, expect, it } from 'vitest';
import { imageHost, loginCommand, registryOfPackage, registryOfSpec } from '@shared/package-registry';
import type { RegistryPackage, RegistryServer } from '@shared/registry';
import type { ServerSpec } from '@shared/types';
import { getVariants, resolveVariant } from '@shared/variants';
import { describeDownload, downloadFailure } from '../src/main/health/download';

const server = (pkg: Partial<RegistryPackage>): RegistryServer => ({
  name: 'com.acme/tickets',
  version: '1.2.0',
  packages: [{ registryType: 'npm', identifier: '@acme/tickets', version: '1.2.0', ...pkg } as RegistryPackage],
});

const resolve = (pkg: Partial<RegistryPackage>) => {
  const res = resolveVariant(server(pkg), { kind: 'package', index: 0 }, 'tickets', {});
  if (!res.ok) throw new Error(res.error);
  return [res.spec.command, ...(res.spec.args ?? [])].join(' ');
};

describe('registryOfPackage', () => {
  it('ignores public registries', () => {
    expect(registryOfPackage({ registryType: 'npm', identifier: 'x', registryBaseUrl: 'https://registry.npmjs.org' })).toEqual({});
    expect(registryOfPackage({ registryType: 'pypi', identifier: 'x', registryBaseUrl: 'https://pypi.org' })).toEqual({});
    expect(registryOfPackage({ registryType: 'nuget', identifier: 'x', registryBaseUrl: 'https://api.nuget.org/v3/index.json' })).toEqual({});
    expect(registryOfPackage({ registryType: 'oci', identifier: 'ghcr.io/acme/x' })).toEqual({});
    expect(registryOfPackage({ registryType: 'oci', identifier: 'acme/x', registryBaseUrl: 'https://docker.io' })).toEqual({});
  });

  it('routes only the scope of a scoped npm package', () => {
    expect(registryOfPackage({ registryType: 'npm', identifier: '@acme/tickets', registryBaseUrl: 'https://npm.acme.com/' }).registry).toEqual({
      type: 'npm',
      url: 'https://npm.acme.com/',
      host: 'npm.acme.com',
      scope: '@acme',
    });
  });

  it('leaves credentials out of the URL, with a warning', () => {
    const r = registryOfPackage({ registryType: 'npm', identifier: 'tickets', registryBaseUrl: 'https://bob:s3cret@npm.acme.com/' });
    expect(r.registry?.url).toBe('https://npm.acme.com/');
    expect(r.warning).toMatch(/credentials/);
    expect(JSON.stringify(r)).not.toContain('s3cret');
  });

  it('refuses a URL that is not http(s)', () => {
    expect(registryOfPackage({ registryType: 'npm', identifier: 'x', registryBaseUrl: 'file:///tmp/registry' }).error).toMatch(/https:\/\//);
    expect(registryOfPackage({ registryType: 'npm', identifier: 'x', registryBaseUrl: 'not a url' }).error).toMatch(/valid URL/);
  });

  it('reads the registry host of an image', () => {
    expect(imageHost('registry.acme.com:5000/team/x:1')).toBe('registry.acme.com:5000');
    expect(imageHost('localhost/x')).toBe('localhost');
    expect(imageHost('acme/x')).toBeUndefined();
    expect(imageHost('x')).toBeUndefined();
    expect(registryOfPackage({ registryType: 'oci', identifier: 'registry.acme.com/team/x' }).registry).toEqual({ type: 'oci', url: 'https://registry.acme.com', host: 'registry.acme.com' });
  });
});

describe('launch command', () => {
  it('adds the registry before the package', () => {
    expect(resolve({ registryBaseUrl: 'https://npm.acme.com/' })).toBe('npx -y --@acme:registry=https://npm.acme.com/ @acme/tickets@1.2.0');
    expect(resolve({ identifier: 'acme-tickets', registryBaseUrl: 'https://npm.acme.com/' })).toBe('npx -y --registry=https://npm.acme.com/ acme-tickets@1.2.0');
    expect(resolve({ registryType: 'pypi', identifier: 'acme-tickets', registryBaseUrl: 'https://pypi.acme.com/simple' })).toBe(
      'uvx --index https://pypi.acme.com/simple acme-tickets@1.2.0',
    );
    expect(resolve({ registryType: 'nuget', identifier: 'Acme.Tickets', registryBaseUrl: 'https://nuget.acme.com/v3/index.json' })).toBe(
      'dnx --add-source https://nuget.acme.com/v3/index.json Acme.Tickets@1.2.0 --yes',
    );
  });

  it('keeps runtime arguments from the registry', () => {
    expect(resolve({ registryBaseUrl: 'https://npm.acme.com/', runtimeArguments: [{ type: 'positional', value: '--yes' }] })).toBe(
      'npx --yes --@acme:registry=https://npm.acme.com/ @acme/tickets@1.2.0',
    );
  });

  it('prefixes the host of a bare image', () => {
    expect(resolve({ registryType: 'oci', identifier: 'team/tickets', registryBaseUrl: 'https://registry.acme.com' })).toBe('docker run -i --rm registry.acme.com/team/tickets:1.2.0');
    expect(resolve({ registryType: 'oci', identifier: 'registry.acme.com/team/tickets' })).toBe('docker run -i --rm registry.acme.com/team/tickets:1.2.0');
  });

  it('adds nothing for a runtime it does not know, and says so', () => {
    expect(resolve({ runtimeHint: 'bunx', registryBaseUrl: 'https://npm.acme.com/' })).toBe('bunx @acme/tickets@1.2.0');
    const [v] = getVariants(server({ runtimeHint: 'bunx', registryBaseUrl: 'https://npm.acme.com/' }));
    expect(v.warning).toMatch(/bunx/);
    expect(v.privateRegistry?.host).toBe('npm.acme.com');
  });

  it('leaves public packages as they were', () => {
    expect(resolve({ registryBaseUrl: 'https://registry.npmjs.org' })).toBe('npx -y @acme/tickets@1.2.0');
    expect(getVariants(server({}))[0].privateRegistry).toBeUndefined();
  });

  it('marks a package with a bad registry URL as unsupported', () => {
    expect(getVariants(server({ registryBaseUrl: 'ftp://npm.acme.com' }))[0].unsupported).toMatch(/https/);
  });
});

describe('registryOfSpec', () => {
  const stdio = (command: string, args: string[]): ServerSpec => ({ name: 'x', transport: 'stdio', command, args });

  it('reads the flags Kumi writes', () => {
    expect(registryOfSpec(stdio('npx', ['-y', '--@acme:registry=https://npm.acme.com/', '@acme/x']))).toMatchObject({ type: 'npm', host: 'npm.acme.com', scope: '@acme' });
    expect(registryOfSpec(stdio('npx', ['-y', '--registry', 'https://npm.acme.com/', 'x']))).toMatchObject({ type: 'npm', host: 'npm.acme.com' });
    expect(registryOfSpec(stdio('uvx', ['--index', 'acme=https://pypi.acme.com/simple', 'x']))).toMatchObject({ type: 'pypi', host: 'pypi.acme.com' });
    expect(registryOfSpec(stdio('dnx', ['--add-source', 'https://nuget.acme.com/v3/index.json', 'X']))).toMatchObject({ type: 'nuget', host: 'nuget.acme.com' });
    expect(registryOfSpec(stdio('docker', ['run', '-i', '--rm', '-e', 'TOKEN', 'registry.acme.com/x:1']))).toMatchObject({ type: 'oci', host: 'registry.acme.com' });
  });

  it('looks through Windows cmd wrappers and paths', () => {
    expect(registryOfSpec(stdio('cmd', ['/c', 'npx', '-y', '--registry=https://npm.acme.com/', 'x']))?.host).toBe('npm.acme.com');
    expect(registryOfSpec(stdio('C:\\Program Files\\nodejs\\npx.cmd', ['--registry=https://npm.acme.com/', 'x']))?.host).toBe('npm.acme.com');
  });

  it('ignores public registries and other commands', () => {
    expect(registryOfSpec(stdio('npx', ['--registry=https://registry.npmjs.org/', 'x']))).toBeUndefined();
    expect(registryOfSpec(stdio('docker', ['run', 'ghcr.io/acme/x']))).toBeUndefined();
    expect(registryOfSpec(stdio('node', ['--registry=https://npm.acme.com/']))).toBeUndefined();
    expect(registryOfSpec({ transport: 'streamable-http', command: 'npx', args: ['--registry=https://npm.acme.com/'] })).toBeUndefined();
  });
});

describe('loginCommand', () => {
  it('uses each tool', () => {
    expect(loginCommand({ type: 'npm', url: 'https://npm.acme.com/', host: 'npm.acme.com', scope: '@acme' })).toBe('npm login --registry=https://npm.acme.com/ --scope=@acme');
    expect(loginCommand({ type: 'oci', url: 'https://registry.acme.com', host: 'registry.acme.com' })).toBe('docker login registry.acme.com');
    expect(loginCommand({ type: 'pypi', url: 'https://pypi.acme.com/simple', host: 'pypi.acme.com' })).toBeUndefined();
  });
});

// Output captured from npm 11 and uv 0.13 against a fake registry.
const NPM_DEP_404 = `npm error code E404
npm error 404 Not Found - GET http://127.0.0.1:4873/kumi-missing-dep - Not found
npm error 404
npm error 404  The requested resource 'kumi-missing-dep@^1.0.0' could not be found or you do not have permission to access it.
`;
const NPM_PKG_404 = `npm error code E404
npm error 404 Not Found - GET http://127.0.0.1:4873/@acme%2fhidden - Not found
npm error 404
npm error 404  The requested resource '@acme/hidden@1.0.0' could not be found or you do not have permission to access it.
`;
const NPM_401 = `npm error code E401
npm error Incorrect or missing password.
`;
const NPM_DNS = `npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://npm.acme.com/acme-tickets failed, reason: getaddrinfo ENOTFOUND npm.acme.com
`;
const NPM_TLS = `npm error code DEPTH_ZERO_SELF_SIGNED_CERT
npm error errno DEPTH_ZERO_SELF_SIGNED_CERT
npm error request to https://npm.acme.com/x failed, reason: self-signed certificate
`;
const UV_401 = `error: No solution found when resolving tool dependencies
  cause: Because acme-tickets was not found in the package registry and you require acme-tickets==1.0, we can conclude that your requirements are unsatisfiable.

hint: An index URL (http://127.0.0.1:4873/simple) could not be queried due to a lack of valid authentication credentials (401 Unauthorized)
`;
const UV_404 = `error: No solution found when resolving tool dependencies
  cause: Because acme-tickets was not found in the package registry and you require acme-tickets==1.0, we can conclude that your requirements are unsatisfiable.
`;
const UV_DNS = `error: Request failed after 3 retries in 9.4s
  cause: Failed to fetch: https://pypi.acme.com/simple/acme-tickets/
  cause: error sending request for url (https://pypi.acme.com/simple/acme-tickets/)
  cause: client error (Connect)
  cause: dns error
  cause: failed to lookup address information: nodename nor servname provided, or not known
`;
const DOCKER_DENIED = `Unable to find image 'registry.acme.com/team/x:1' locally
docker: Error response from daemon: Head "https://registry.acme.com/v2/team/x/manifests/1": unauthorized: authentication required.
`;
const DOCKER_MISBEHAVING = `Unable to find image 'registry.acme.com/team/x:1' locally
docker: Error response from daemon: failed to resolve reference "registry.acme.com/team/x:1": failed to do request: Head "https://registry.acme.com/v2/team/x/manifests/1": dial tcp: lookup registry.acme.com on 192.168.5.1:53: server misbehaving
`;
const DOCKER_DNS = `Unable to find image 'registry.acme.com/team/x:1' locally
docker: Error response from daemon: Get "https://registry.acme.com/v2/": dial tcp: lookup registry.acme.com: no such host.
`;

describe('downloadFailure', () => {
  const npx = (args: string[]): ServerSpec => ({ name: 'x', transport: 'stdio', command: 'npx', args: ['-y', ...args] });
  const unscoped = npx(['--registry=http://127.0.0.1:4873/', 'acme-tickets@1.0.0']);
  const scoped = npx(['--@acme:registry=http://127.0.0.1:4873/', '@acme/hidden@1.0.0']);

  it('tells a registry without npmjs from a missing package', () => {
    const f = downloadFailure(unscoped, NPM_DEP_404)!;
    expect(f).toMatchObject({ cause: 'no-mirror', dependency: 'kumi-missing-dep', host: '127.0.0.1:4873' });
    expect(describeDownload(f, unscoped)).toMatch(/doesn't mirror npmjs\.org/);
    expect(downloadFailure(scoped, NPM_PKG_404)).toMatchObject({ cause: 'not-found', host: '127.0.0.1:4873' });
    expect(downloadFailure(scoped, NPM_PKG_404)?.dependency).toBeUndefined();
  });

  it('says a private registry wants a sign-in, using its host when npm leaves it out', () => {
    const f = downloadFailure(scoped, NPM_401)!;
    expect(f).toMatchObject({ cause: 'sign-in', host: '127.0.0.1:4873', registry: { scope: '@acme' } });
    expect(describeDownload(f, scoped)).toMatch(/wants you to sign in/);
    expect(describeDownload(downloadFailure(scoped, NPM_PKG_404)!, scoped)).toMatch(/until you sign in/);
  });

  it('reads network and certificate failures', () => {
    const spec = npx(['--registry=https://npm.acme.com/', 'acme-tickets']);
    expect(downloadFailure(spec, NPM_DNS)).toMatchObject({ cause: 'network', network: 'dns', host: 'npm.acme.com' });
    expect(describeDownload(downloadFailure(spec, NPM_DNS)!, spec)).toBe("Couldn't download the package from npm.acme.com: the name doesn't resolve");
    expect(downloadFailure(spec, NPM_TLS)).toMatchObject({ cause: 'tls', host: 'npm.acme.com' });
    expect(describeDownload(downloadFailure(spec, NPM_TLS)!, spec)).toMatch(/NODE_EXTRA_CA_CERTS/);
  });

  it('reads uv', () => {
    const spec: ServerSpec = { name: 'x', transport: 'stdio', command: 'uvx', args: ['--index', 'http://127.0.0.1:4873/simple', 'acme-tickets@1.0'] };
    expect(downloadFailure(spec, UV_401)).toMatchObject({ cause: 'sign-in', host: '127.0.0.1:4873' });
    expect(downloadFailure(spec, UV_404)).toMatchObject({ cause: 'not-found' });
    expect(downloadFailure(spec, UV_404)?.dependency).toBeUndefined();
    expect(downloadFailure(spec, UV_DNS)).toMatchObject({ cause: 'network', network: 'dns', host: 'pypi.acme.com' });
  });

  it('reads docker', () => {
    const spec: ServerSpec = { name: 'x', transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', 'registry.acme.com/team/x:1'] };
    expect(downloadFailure(spec, DOCKER_DENIED)).toMatchObject({ cause: 'sign-in', registry: { host: 'registry.acme.com' } });
    expect(downloadFailure(spec, DOCKER_DNS)).toMatchObject({ cause: 'network', network: 'dns', host: 'registry.acme.com' });
    expect(downloadFailure(spec, DOCKER_MISBEHAVING)).toMatchObject({ cause: 'network', network: 'dns', host: 'registry.acme.com' });
  });

  it('works for public registries too, without the sign-in advice', () => {
    const spec = npx(['acme-tickets']);
    const f = downloadFailure(spec, NPM_401)!;
    expect(f).toMatchObject({ cause: 'sign-in' });
    expect(f.registry).toBeUndefined();
    expect(describeDownload(f, spec)).toMatch(/credentials for it are missing or out of date/);
  });

  it('stays out of the way when the output says nothing about a download', () => {
    expect(downloadFailure(npx(['x']), 'Error: Missing ACME_TOKEN\n    at main (index.js:3)')).toBeUndefined();
    expect(downloadFailure({ name: 'x', transport: 'stdio', command: 'node', args: ['x.js'] }, NPM_401)).toBeUndefined();
  });
});
