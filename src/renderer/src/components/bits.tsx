import { Boxes, Network, Package } from 'lucide-react';
import { useState } from 'react';
import type { PackageRegistry } from '@shared/package-registry';
import { matchHost, type PrivateNetwork } from '@shared/private-network';
import type { RegistryServer } from '@shared/registry';
import type { ClientId, DiffLine, ScopeRef } from '@shared/types';
import iconDark from '../../../../build/icon-dark.svg';
import iconLight from '../../../../build/icon-light.svg';
import { useDarkMode, useSettings } from '../lib/hooks';
import { Badge, cx } from './ui';

const CLIENT_STYLE: Record<ClientId, { short: string; color: string }> = {
  'claude-desktop': { short: 'CD', color: '#d97757' },
  'claude-code': { short: 'CC', color: '#c15f3c' },
  vscode: { short: 'VS', color: '#0e7acc' },
  cursor: { short: 'Cu', color: '#555555' },
  codex: { short: 'Cx', color: '#10a37f' },
  'copilot-cli': { short: 'GH', color: '#8957e5' },
  // OpenCode's brand is near-black, which disappears on the dark theme; a warm gray reads on both.
  opencode: { short: 'OC', color: '#6f6259' },
  pi: { short: 'Pi', color: '#3b6fd4' },
  junie: { short: 'Ju', color: '#3d9a50' },
  'jetbrains-air': { short: 'Ai', color: '#7b5cff' },
  zed: { short: 'Ze', color: '#084ccf' },
  cline: { short: 'Cl', color: '#5b6cf0' },
  hermes: { short: 'He', color: '#9a6b14' },
};

/** Kumi's own icon, in the variant that suits the current theme. */
export function AppIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <picture className={cx('shrink-0', className)}>
      <source srcSet={iconDark} media="(prefers-color-scheme: dark)" />
      <img src={iconLight} width={size} height={size} alt="" draggable={false} className="block" />
    </picture>
  );
}

export function ClientMark({ id, size = 22 }: { id: ClientId; size?: number }) {
  const s = CLIENT_STYLE[id];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ background: s.color, width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {s.short}
    </span>
  );
}

export function scopeLabel(scope: ScopeRef): string {
  if (scope.kind === 'user') return 'Global';
  const folder = scope.projectDir?.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return `${scope.kind === 'local' ? 'Local' : 'Project'} · ${folder}`;
}

/** The registry icon when there is one (preferring the right theme), else a monogram. */
export function ServerIcon({ server, size = 40 }: { server: Pick<RegistryServer, 'name' | 'title' | 'icons'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  const dark = useDarkMode();
  const icon =
    server.icons?.find((i) => i.theme === (dark ? 'dark' : 'light')) ?? server.icons?.find((i) => !i.theme) ?? server.icons?.[0];
  const src = icon?.src?.startsWith('https://') ? icon.src : undefined;
  const label = (server.title ?? server.name.split('/').pop() ?? '?').replace(/[^A-Za-z0-9]/g, '');
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-sunken"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-contain p-1" onError={() => setFailed(true)} referrerPolicy="no-referrer" />
      ) : label ? (
        <span className="font-semibold text-muted" style={{ fontSize: size * 0.38 }}>
          {label.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <Package className="size-1/2 text-muted" />
      )}
    </div>
  );
}

export function DiffView({ lines }: { lines: DiffLine[] }) {
  if (!lines.length) return <div className="text-sm text-muted">No changes.</div>;
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-sunken py-2 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cx(
            'px-3 whitespace-pre',
            l.kind === 'add' && 'bg-add',
            l.kind === 'del' && 'bg-del',
            l.kind === 'skip' && 'text-muted italic',
          )}
        >
          <span className="mr-2 inline-block w-3 select-none text-muted">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

export function displayName(server: Pick<RegistryServer, 'name' | 'title'>): string {
  return server.title ?? server.name.split('/').pop() ?? server.name;
}

/** " (matches *.acme.com)" when a pattern decided it; nothing when the registry said so. */
export function privateNetworkDetail(p: PrivateNetwork): string {
  return p.pattern ? ` (matches ${p.pattern})` : '';
}

/** "Only reachable on Acme GlobalProtect", with how Kumi knows. */
export function privateNetworkTitle(p: PrivateNetwork): string {
  const where = p.vpn ?? 'a private network';
  if (p.source === 'registry') return `Only reachable on ${where}, according to its registry.`;
  return `Only reachable on ${where}${privateNetworkDetail(p)}.`;
}

/** The VPN a private registry needs, from the Private networks patterns (its host without the port). */
export function useRegistryNetwork(registry: PackageRegistry | undefined): PrivateNetwork | undefined {
  const settings = useSettings();
  if (!registry || !settings.data) return undefined;
  return matchHost(registry.host.replace(/:\d+$/, ''), settings.data);
}

/** "Downloads from npm.acme.com (@acme packages), a private registry." with the VPN when a pattern names one. */
export function privateRegistryTitle(r: PackageRegistry, network: PrivateNetwork | undefined): string {
  const scope = r.scope ? ` (${r.scope} packages)` : '';
  if (!network) return `Downloads from ${r.host}${scope}, a private registry. You may need to sign in to it.`;
  const vpn = network.vpn ?? 'a private network';
  return `Downloads from ${r.host}${scope}, a private registry on ${vpn}${privateNetworkDetail(network)}. Once downloaded, the server may run without ${network.vpn ? 'it' : 'that network'}.`;
}

export function PrivateRegistryBadge({ registry }: { registry: PackageRegistry | undefined }) {
  const network = useRegistryNetwork(registry);
  if (!registry) return null;
  return (
    <Badge tone="accent" title={privateRegistryTitle(registry, network)}>
      <Boxes className="size-3" /> private registry
    </Badge>
  );
}

export function PrivateNetworkBadge({ network }: { network: PrivateNetwork | undefined }) {
  if (!network) return null;
  return (
    <Badge tone="accent" title={privateNetworkTitle(network)}>
      <Network className="size-3" /> private network
    </Badge>
  );
}
