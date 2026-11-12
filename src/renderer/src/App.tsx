import { useQuery } from '@tanstack/react-query';
import { Compass, Info, Layers, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatalogItem } from '@shared/registry';
import { AppIcon } from './components/bits';
import { InstallWizard, type WizardSource } from './components/InstallWizard';
import { cx } from './components/ui';
import { UpdateBanner } from './components/Updates';
import { api } from './lib/api';
import { useInstalled } from './lib/hooks';
import { dismissSplash } from './lib/splash';
import { About } from './pages/About';
import { Discover } from './pages/Discover';
import { Installed } from './pages/Installed';
import { ServerDetail } from './pages/ServerDetail';
import { Settings } from './pages/Settings';
import { Welcome } from './pages/Welcome';

type Route = { page: 'discover' } | { page: 'server'; item: CatalogItem } | { page: 'installed' } | { page: 'settings' } | { page: 'about' };

function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: ReactNode; label: string; badge?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'no-drag flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-sm font-medium transition',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink',
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {!!badge && <span className="rounded-full bg-sunken px-1.5 text-[11px] text-muted">{badge}</span>}
      {active && <span className="size-1.5 rounded-full bg-spark" />}
    </button>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'discover' });
  const [wizard, setWizard] = useState<WizardSource | null>(null);
  const installed = useInstalled();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settingsGet });
  const serverCount = new Set(installed.data?.entries.map((e) => e.name)).size;
  const main = useRef<HTMLElement>(null);

  const go = (r: Route) => {
    setRoute(r);
    main.current?.scrollTo({ top: 0 });
  };
  const section = route.page === 'server' ? 'discover' : route.page;

  // Both wait for startup, so together they mark when the app is ready to show.
  const ready = !installed.isPending && !settings.isPending;
  useEffect(() => {
    if (ready) dismissSplash();
  }, [ready]);

  // The splash covers the window until settings load. If they can't, show the app rather than block it.
  if (!ready) return null;
  if (settings.data && !settings.data.setupDone) return <Welcome />;

  return (
    <div className="flex h-full">
      <aside className="drag flex w-56 shrink-0 flex-col border-r border-line bg-panel/60 px-3 pt-11 pb-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <AppIcon size={34} />
          <div>
            <div className="text-lg leading-tight font-semibold tracking-tight">
              Kumi
            </div>
            <div className="text-xs text-muted">MCP marketplace</div>
          </div>
        </div>
        <nav className="space-y-1">
          <NavItem active={section === 'discover'} icon={<Compass className="size-4" />} label="Discover" onClick={() => go({ page: 'discover' })} />
          <NavItem active={section === 'installed'} icon={<Layers className="size-4" />} label="Installed" badge={serverCount} onClick={() => go({ page: 'installed' })} />
          <NavItem active={section === 'settings'} icon={<SettingsIcon className="size-4" />} label="Settings" onClick={() => go({ page: 'settings' })} />
        </nav>
        <div className="mt-auto">
          <NavItem active={section === 'about'} icon={<Info className="size-4" />} label="About" onClick={() => go({ page: 'about' })} />
        </div>
      </aside>

      <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
        <div className="drag h-8" />
        <div className="mx-auto max-w-6xl px-8 pb-12">
          <UpdateBanner />
          {/* Keep Discover mounted so search results and scroll survive opening a server. */}
          <div hidden={route.page !== 'discover'}>
            <Discover onOpen={(item) => go({ page: 'server', item })} />
          </div>
          {route.page === 'server' && (
            <ServerDetail
              initial={route.item}
              onBack={() => go({ page: 'discover' })}
              onInstall={(server) => setWizard({ kind: 'registry', registryId: route.item.registryId, server })}
            />
          )}
          {route.page === 'installed' && <Installed onEdit={setWizard} onAddCustom={() => setWizard({ kind: 'custom' })} />}
          {route.page === 'settings' && <Settings />}
          {route.page === 'about' && <About />}
        </div>
      </main>

      {wizard && (
        <InstallWizard
          source={wizard}
          onClose={() => setWizard(null)}
          onViewInstalled={() => {
            setWizard(null);
            go({ page: 'installed' });
          }}
        />
      )}
    </div>
  );
}
