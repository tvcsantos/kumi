import { useQuery } from '@tanstack/react-query';
import { BookOpen, Code2, ExternalLink, Library } from 'lucide-react';
import { AppIcon, ClientMark } from '../components/bits';
import { Badge, Button } from '../components/ui';
import { api, errorMessage } from '../lib/api';

const LINKS = [
  { label: 'Source code', url: 'https://github.com/tvcsantos/kumi', icon: Code2 },
  { label: 'MCP Registry', url: 'https://registry.modelcontextprotocol.io', icon: Library },
  { label: 'Model Context Protocol', url: 'https://modelcontextprotocol.io', icon: BookOpen },
];

function open(url: string) {
  api.openExternal(url).catch((e) => window.alert(errorMessage(e)));
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

export function About() {
  const info = useQuery({ queryKey: ['appInfo'], queryFn: api.appInfo, staleTime: Infinity });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clientsList });

  const details: [string, string | undefined][] = [
    ['Version', info.data?.version],
    ['Electron', info.data?.electron],
    ['Chromium', info.data?.chrome],
    ['Node.js', info.data?.node],
    ['Platform', info.data?.platform],
    ['Data folder', info.data?.dataDir],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 pt-6 pb-4 text-center">
        <AppIcon size={112} className="drop-shadow-md" />
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Kumi
        </h1>
        <p className="max-w-md text-muted">Find MCP servers, fill in their settings once, and install them into every AI tool you use.</p>
        {info.data && <Badge>Version {info.data.version}</Badge>}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {LINKS.map(({ label, url, icon: Icon }) => (
            <Button key={url} size="sm" icon={<Icon className="size-3.5" />} onClick={() => open(url)}>
              {label}
              <ExternalLink className="size-3 text-muted" />
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="The name">
          <p className="text-muted">
            <span className="font-medium text-ink">Kumi</span> [kɯ.mi] (組) means a group, a set or a team. As a verb, <span className="italic">kumu</span> is to
            assemble, or to braid, as in <span className="italic">kumihimo</span>, the Japanese art of braided cord.
          </p>
          <p className="mt-2 text-muted">Kumi assembles your MCP servers into one set and weaves them into each of your tools.</p>
        </Card>

        <Card title="Works with">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {clients.data?.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <ClientMark id={c.id} size={20} />
                <span className="truncate">{c.displayName}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Details">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 truncate font-mono text-[12px] leading-5" title={value}>
                {value ?? '…'}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <p className="pt-2 text-center text-xs text-muted">MIT License · Made by Tiago Santos</p>
    </div>
  );
}
