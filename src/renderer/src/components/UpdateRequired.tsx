// Covers the whole window while a release newer than this one is marked required. The main process
// refuses everything else too (see ipc.ts), so this is the only way forward: update, or quit.

import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, FileText, Info, LogOut, RefreshCw, RotateCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { UpdateStatus } from '@shared/api';
import { api, errorMessage } from '../lib/api';
import { About } from '../pages/About';
import { AppIcon } from './bits';
import { Button, Callout, Spinner } from './ui';
import { CopyCommand, DownloadProgress, open, useCheckForUpdates, useUpdateActions } from './Updates';

function alertError(e: unknown) {
  window.alert(errorMessage(e));
}

/** The one step that gets this install onto the required version. */
function NextStep({ status }: { status: UpdateStatus }) {
  const check = useCheckForUpdates();
  const { retry, restart } = useUpdateActions();
  const urgency = status.urgency!;
  const download = (url: string, primary: boolean) => (
    <Button variant={primary ? 'primary' : 'secondary'} icon={<Download className="size-4" />} onClick={() => open(url)}>
      Download
    </Button>
  );
  const error = status.error && <p className="text-sm text-danger">{status.error}</p>;

  if (status.state === 'downloading') return <DownloadProgress status={status} />;
  if (status.state === 'ready') {
    return (
      <div className="space-y-3">
        <p>The update is downloaded. Kumi restarts into the new version.</p>
        <Button variant="primary" icon={<RotateCw className="size-4" />} loading={restart.isPending} onClick={() => restart.mutate()}>
          Restart to update
        </Button>
      </div>
    );
  }
  if (status.command) {
    return (
      <div className="space-y-3">
        <p>Quit Kumi and run the command below, or run it now and then restart Kumi.</p>
        <CopyCommand command={status.command} />
      </div>
    );
  }
  if (status.state === 'checking') return <Spinner label="Checking for updates…" />;
  if (!status.latest) {
    // Remembered from an earlier run, but this check couldn't reach GitHub.
    return (
      <div className="space-y-3">
        {error}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>
            Check again
          </Button>
          {download(urgency.url, false)}
        </div>
      </div>
    );
  }
  if (status.inApp) {
    if (!status.error) return <Spinner label="Starting the download…" />;
    return (
      <div className="space-y-3">
        {error}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={retry.isPending} onClick={() => retry.mutate()}>
            Try again
          </Button>
          {download(status.latest.url, false)}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {status.manualReason && <p className="text-muted">{status.manualReason}</p>}
      {download(status.latest.url, true)}
    </div>
  );
}

export function UpdateRequired({ status }: { status: UpdateStatus }) {
  const [about, setAbout] = useState(false);
  const quit = useMutation({ mutationFn: api.appQuit, onError: alertError });
  const urgency = status.urgency!;
  const target = status.latest?.version ?? urgency.version;

  if (about) {
    return (
      <main className="h-full overflow-y-auto">
        <div className="drag h-8" />
        <div className="mx-auto max-w-6xl px-8 pb-12">
          <Button size="sm" variant="ghost" className="no-drag mb-2" icon={<ArrowLeft className="size-3.5" />} onClick={() => setAbout(false)}>
            Back
          </Button>
          <About />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="drag h-8 shrink-0" />
      <div className="flex flex-1 items-center justify-center px-8 pb-12">
        <div className="w-full max-w-lg space-y-5 rounded-2xl border border-line bg-panel p-8 text-sm">
          <div className="flex items-center gap-3">
            <AppIcon size={44} />
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <ShieldAlert className="size-5 text-warn" />
                Update required
              </h1>
              <p className="text-muted">
                Kumi {status.currentVersion} needs to be updated to Kumi {target} before you can use it again.
              </p>
            </div>
          </div>
          {urgency.reason && <Callout tone="warn">{urgency.reason}</Callout>}
          <NextStep status={status} />
          <div className="flex flex-wrap gap-1 border-t border-line pt-4">
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => open(status.latest?.url ?? urgency.url)}>
              What's new
            </Button>
            <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => api.revealLog().catch(alertError)}>
              Show log
            </Button>
            <Button size="sm" variant="ghost" icon={<Info className="size-3.5" />} onClick={() => setAbout(true)}>
              About
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={quit.isPending} onClick={() => quit.mutate()}>
              Quit
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
