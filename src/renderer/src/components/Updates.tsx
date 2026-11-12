import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, RefreshCw, RotateCw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { UpdateStatus } from '@shared/api';
import { api, errorMessage } from '../lib/api';
import { Button, Spinner } from './ui';

const KEY = ['updateStatus'];

/** The main process checks every few hours; polling picks up what it found, and follows a download closely. */
export function useUpdateStatus() {
  return useQuery({
    queryKey: KEY,
    queryFn: api.updateStatus,
    refetchInterval: (query) => (query.state.data?.state === 'downloading' ? 1000 : 10 * 60_000),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.updateCheck,
    onMutate: () => queryClient.setQueryData<UpdateStatus>(KEY, (s) => (s && s.state !== 'downloading' && s.state !== 'ready' ? { ...s, state: 'checking' } : s)),
    onSettled: (status) => (status ? queryClient.setQueryData(KEY, status) : void queryClient.invalidateQueries({ queryKey: KEY })),
  });
}

function useUpdateActions() {
  const queryClient = useQueryClient();
  const set = (s: UpdateStatus) => queryClient.setQueryData(KEY, s);
  return {
    dismiss: useMutation({ mutationFn: api.updateDismiss, onSuccess: set }),
    retry: useMutation({ mutationFn: api.updateDownload, onSuccess: set }),
    restart: useMutation({ mutationFn: api.updateRestart, onError: (e) => window.alert(errorMessage(e)) }),
  };
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

/** What the user can do about an update: restart into it, retry a failed download, or get it themselves. */
function UpdateActions({ status }: { status: UpdateStatus }) {
  const { retry, restart } = useUpdateActions();
  const latest = status.latest!;

  if (status.state === 'ready') {
    return (
      <Button size="sm" variant="primary" icon={<RotateCw className="size-3.5" />} loading={restart.isPending} onClick={() => restart.mutate()}>
        Restart to update
      </Button>
    );
  }
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
  const download = (
    <Button size="sm" variant={status.inApp ? 'secondary' : 'primary'} icon={<Download className="size-3.5" />} onClick={() => open(latest.url)}>
      Download
    </Button>
  );
  if (status.inApp) {
    // Only reached when the background download failed.
    return (
      <>
        <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} loading={retry.isPending} onClick={() => retry.mutate()}>
          Try again
        </Button>
        {download}
      </>
    );
  }
  return download;
}

function bannerText(status: UpdateStatus): React.ReactNode {
  const name = <span className="font-medium">Kumi {status.latest!.version}</span>;
  if (status.state === 'ready') return <>{name} is ready. It installs when you quit Kumi.</>;
  if (status.inApp) return <>{name} is available, but it couldn't be downloaded.</>;
  if (status.command) return <>{name} is available. Update it with Homebrew:</>;
  return <>{name} is available.</>;
}

/**
 * Shown above every page, until dismissed for this session, when there's something to do:
 * a downloaded update to restart into, a failed download, or an update to get by hand.
 * A download in progress stays quiet; About shows it.
 */
export function UpdateBanner() {
  const { data: status } = useUpdateStatus();
  const { dismiss } = useUpdateActions();
  if (!status?.latest || status.dismissed) return null;
  const show = status.state === 'ready' || (status.state === 'available' && (!status.inApp || !!status.error));
  if (!show) return null;

  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-accent-soft px-4 py-2.5 text-sm">
      <Sparkles className="size-4 shrink-0 text-accent" />
      <span className="flex-1">{bannerText(status)}</span>
      <UpdateActions status={status} />
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

  const version = <span className="font-medium">Kumi {status.latest?.version}</span>;
  let line: React.ReactNode;
  switch (status.state) {
    case 'checking':
      line = <Spinner label="Checking for updates…" />;
      break;
    case 'downloading':
      line = (
        <div className="space-y-1.5">
          <span>
            Downloading {version}… {Math.round((status.progress ?? 0) * 100)}%
          </span>
          <div className="h-1.5 max-w-sm overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(status.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      );
      break;
    case 'ready':
      line = <span>{version} is ready. It installs when you quit Kumi.</span>;
      break;
    case 'available':
      line = <span>{version} is available.</span>;
      break;
    case 'up-to-date':
      line = <span>You're on the latest version. {checkedAt(status)}</span>;
      break;
    case 'error':
      line = <span className="text-danger">Couldn't check for updates: {status.error}</span>;
      break;
    default:
      line = <span className="text-muted">{status.installKind === 'dev' ? 'Development build: Kumi only checks when you ask.' : 'Not checked yet.'}</span>;
  }
  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">{line}</div>
        {status.state !== 'ready' && (
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={() => check.mutate()}>
            Check for updates
          </Button>
        )}
      </div>
      {(status.state === 'available' || status.state === 'ready') && status.latest && (
        <div className="flex flex-wrap items-center gap-2">
          <UpdateActions status={status} />
        </div>
      )}
      {status.error && status.state !== 'error' && <p className="text-xs text-danger">{status.error}</p>}
      {status.installKind === 'homebrew' && status.state !== 'available' && (
        <p className="text-xs text-muted">
          Installed with Homebrew, so updates come from <code className="font-mono">brew upgrade</code>.
        </p>
      )}
      {!status.inApp && status.manualReason && <p className="text-xs text-muted">{status.manualReason}</p>}
    </div>
  );
}
