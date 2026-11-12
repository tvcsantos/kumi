import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { UpdateStatus } from '@shared/api';
import { api, errorMessage } from '../lib/api';
import { Button, Spinner } from './ui';

const KEY = ['updateStatus'];

/** The main process checks every few hours; polling now and then picks up what it found. */
export function useUpdateStatus() {
  return useQuery({ queryKey: KEY, queryFn: api.updateStatus, refetchInterval: 10 * 60_000, refetchOnWindowFocus: true, staleTime: 0 });
}

export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.updateCheck,
    onMutate: () => queryClient.setQueryData<UpdateStatus>(KEY, (s) => (s ? { ...s, state: 'checking' } : s)),
    onSettled: (status) => (status ? queryClient.setQueryData(KEY, status) : void queryClient.invalidateQueries({ queryKey: KEY })),
  });
}

function open(url: string) {
  api.openExternal(url).catch((e) => window.alert(errorMessage(e)));
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    api
      .copyText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((e) => window.alert(errorMessage(e)));
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel py-0.5 pr-0.5 pl-3">
      <code className="font-mono text-[12px]">{command}</code>
      <Button size="sm" variant="ghost" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={copy} aria-label="Copy command">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

/** How to get the new version: the package manager's command, or the release page. */
function UpdateAction({ status }: { status: UpdateStatus }) {
  const latest = status.latest!;
  if (status.command) {
    return (
      <>
        <CopyCommand command={status.command} />
        <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => open(latest.url)}>
          What's new
        </Button>
      </>
    );
  }
  return (
    <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={() => open(latest.url)}>
      Download
    </Button>
  );
}

/** Shown above every page when a newer Kumi is out, until dismissed for this session. */
export function UpdateBanner() {
  const queryClient = useQueryClient();
  const { data: status } = useUpdateStatus();
  const dismiss = useMutation({ mutationFn: api.updateDismiss, onSuccess: (s) => queryClient.setQueryData(KEY, s) });
  if (!status || status.state !== 'available' || !status.latest || status.dismissed) return null;

  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-accent-soft px-4 py-2.5 text-sm">
      <Sparkles className="size-4 shrink-0 text-accent" />
      <span className="flex-1">
        <span className="font-medium">Kumi {status.latest.version}</span> is available
        {status.command ? '. Update it with Homebrew:' : '.'}
      </span>
      <UpdateAction status={status} />
      <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} aria-label="Dismiss" onClick={() => dismiss.mutate(status.latest!.version)} />
    </div>
  );
}

function checkedAt(status: UpdateStatus) {
  return status.checkedAt ? `Checked ${new Date(status.checkedAt).toLocaleString()}.` : '';
}

/** The update state and a manual check, for the About page. */
export function UpdateCard() {
  const { data: status } = useUpdateStatus();
  const check = useCheckForUpdates();
  if (!status) return <Spinner />;

  let line: React.ReactNode;
  switch (status.state) {
    case 'checking':
      line = <Spinner label="Checking for updates…" />;
      break;
    case 'available':
      line = (
        <span>
          <span className="font-medium">Kumi {status.latest!.version}</span> is available.
        </span>
      );
      break;
    case 'up-to-date':
      line = <span>You're on the latest version. {checkedAt(status)}</span>;
      break;
    case 'error':
      line = <span className="text-danger">Couldn't check for updates: {status.error}</span>;
      break;
    default:
      line = <span className="text-muted">{status.installKind === 'dev' ? "Development build: Kumi only checks when you ask." : 'Not checked yet.'}</span>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">{line}</div>
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={status.state === 'checking'} onClick={() => check.mutate()}>
          Check for updates
        </Button>
      </div>
      {status.state === 'available' && status.latest && (
        <div className="flex flex-wrap items-center gap-2">
          <UpdateAction status={status} />
        </div>
      )}
      {status.state === 'available' && status.error && <p className="text-xs text-muted">The last check failed: {status.error}</p>}
      {status.installKind === 'homebrew' && status.state !== 'available' && <p className="text-xs text-muted">Installed with Homebrew, so updates come from <code className="font-mono">brew upgrade</code>.</p>}
    </div>
  );
}
