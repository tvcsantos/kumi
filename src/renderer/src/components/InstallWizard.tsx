import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Check, CheckCircle2, FileText, FolderOpen, LogIn, Network, Package, PlugZap, RotateCcw, WifiOff, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bundleVariant } from '@shared/mcpb';
import { satisfies } from '@shared/semver';
import { canPassRegistry, loginAdvice, loginCommand, type PackageRegistry } from '@shared/package-registry';
import { privateNetworkFor, registryPrivateNetwork, type PrivateNetwork } from '@shared/private-network';
import type { PreparedBundle } from '@shared/mcpb';
import type { RegistryServer } from '@shared/registry';
import type {
  ApplyResult,
  ClientId,
  ClientInfo,
  HealthResult,
  InstallPlan,
  InstallRequest,
  InstallTarget,
  ScopeKind,
  SecretsMode,
  ServerSpec,
} from '@shared/types';
import { defaultVariant, getVariants, initialValues, resolveVariant, suggestName, validateValues, type FormValues } from '@shared/variants';
import { api, errorMessage } from '../lib/api';
import { useRecheckRuntimesOnFocus, useRuntimes, useSettings } from '../lib/hooks';
import { ClientMark, DiffView, displayName, privateNetworkDetail, scopeLabel, ServerIcon, useRegistryNetwork } from './bits';
import { CustomServerForm, customFormFromSpec, specFromCustomForm, type CustomForm } from './CustomServerForm';
import { FieldInput } from './FieldInput';
import { Badge, Button, Callout, Input, Modal, Spinner, cx } from './ui';

export type WizardSource =
  | {
      kind: 'registry';
      registryId: string;
      server: RegistryServer;
      /** Present when editing an existing install. */
      edit?: { name: string; variantRef: { kind: 'package' | 'remote'; index: number }; values: FormValues; targets: InstallTarget[]; secretsMode: SecretsMode };
    }
  | { kind: 'custom'; spec?: ServerSpec; targets?: InstallTarget[]; edit?: boolean };

type Step = 'configure' | 'targets' | 'review' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'configure', label: 'Configure' },
  { id: 'targets', label: 'Choose apps' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

interface TargetState {
  selected: boolean;
  scope: ScopeKind;
  projectDir?: string;
}

const SCOPE_TEXT: Record<ScopeKind, string> = {
  user: 'Global: every project',
  project: 'Project: saved in the repo, shared with your team',
  local: 'Local: this project, only for you',
};

function Steps({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={cx(
              'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
              i < idx ? 'bg-ok text-paper' : i === idx ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted',
            )}
          >
            {i < idx ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={cx(i === idx ? 'text-ink font-medium' : 'text-muted')}>{s.label}</span>
          {i < STEPS.length - 1 && <span className="h-px w-5 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

/** What "Test connection" is doing. A test never opens the browser; signing in is a separate step. */
export function testingLabel(spec: ServerSpec | undefined, firstRun = false): string {
  if (spec && spec.transport !== 'stdio') return 'Connecting…';
  return firstRun ? 'Starting the server… (first run may download it)' : 'Starting the server…';
}

function ShowLog() {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs opacity-80">
      <span>The full output is saved in Kumi's log.</span>
      <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => api.revealLog().catch((e) => window.alert(errorMessage(e)))}>
        Show log
      </Button>
    </div>
  );
}

/** The server is up and asks for OAuth sign-in. Signing in here is optional: it only lets Kumi list the tools. */
function SignInPanel({ result, spec, onResult }: { result: HealthResult; spec: ServerSpec; onResult: (r: HealthResult) => void }) {
  const [error, setError] = useState<string | null>(null);
  const signIn = useMutation({
    mutationFn: () => api.healthTest(spec, { signIn: true }),
    onMutate: () => setError(null),
    onSuccess: (r) => (r.ok ? onResult(r) : setError(r.error ?? 'Sign-in failed.')),
    onError: (e) => setError(errorMessage(e)),
  });
  const available = result.signIn?.available;
  return (
    <div className="space-y-2">
      <Callout tone="ok" icon={<CheckCircle2 className="size-4" />}>
        <div className="font-medium">Server is up</div>
        <div>It asks you to sign in, which each of your apps does the first time it connects.</div>
        {available ? (
          <div className="mt-2">
            <Button size="sm" icon={<LogIn className="size-3.5" />} loading={signIn.isPending} onClick={() => signIn.mutate()}>
              Sign in to list tools
            </Button>
          </div>
        ) : (
          <div className="mt-1 opacity-80">{result.signIn?.reason} Kumi can't list its tools, but your apps can.</div>
        )}
      </Callout>
      {signIn.isPending && <Spinner label="Waiting for you to sign in in your browser…" />}
      {error && (
        <Callout tone="danger" icon={<XCircle className="size-4" />}>
          <div className="break-words">{error}</div>
          <ShowLog />
        </Callout>
      )}
    </div>
  );
}

/** Ends a message with a full stop unless it already ends with punctuation. */
const sentence = (s: string | undefined) => (s && !/[.!?…]$/.test(s) ? `${s}.` : (s ?? ''));

/** What to do about a server Kumi couldn't reach, depending on whether it's known to be on a private network. */
function unreachableAdvice(host: string, network: PrivateNetwork | undefined): string {
  if (!network) return "If this server is on a VPN or private network, connect and test again. Your apps can use it once you're connected.";
  return `${host} is on a private network${privateNetworkDetail(network)}: connect to ${network.vpn ?? 'your VPN'} and test again. Your apps can use it once you're connected.`;
}

/** Same, for the registry a package is downloaded from: once downloaded, the package may run without the VPN. */
function registryUnreachableAdvice(host: string, network: PrivateNetwork | undefined): string {
  if (!network) return 'If this is a company registry on a VPN or private network, connect and test again.';
  return `${host} is on a private network${privateNetworkDetail(network)}: connect to ${network.vpn ?? 'your VPN'} and test again. Once the package is downloaded, your apps may run it without the VPN.`;
}

/** How to sign in to a private registry: the tool's own command, or where its credentials go. */
function LoginHint({ registry, lead = 'Sign in once, then test again:' }: { registry: PackageRegistry; lead?: string }) {
  const cmd = loginCommand(registry);
  if (!cmd) return <div className="mt-1">{loginAdvice(registry)}</div>;
  return (
    <div className="mt-1">
      {lead}
      <pre className="mt-1 overflow-x-auto rounded bg-black/5 px-2 py-1 font-mono text-[12px] whitespace-pre-wrap select-all dark:bg-white/10">{cmd}</pre>
    </div>
  );
}

/**
 * Downloads from a private registry: what that means, and how to sign in. `passed` is false when the package runs
 * with a tool Kumi can't hand the registry to; the variant's warning then says so.
 */
function PrivateRegistryNote({ registry, passed }: { registry: PackageRegistry; passed: boolean }) {
  const network = useRegistryNetwork(registry);
  const where = (
    <>
      Downloads from {registry.host}
      {registry.scope ? ` (${registry.scope} packages)` : ''}, a private registry
      {network ? ` on ${network.vpn ?? 'a private network'}${privateNetworkDetail(network)}` : ''}.
    </>
  );
  if (!passed) {
    return (
      <Callout tone="accent" icon={<Boxes className="size-4" />}>
        {where}
      </Callout>
    );
  }
  return (
    <Callout tone="accent" icon={<Boxes className="size-4" />}>
      {where} Kumi adds it to the command, so every app downloads from there; signing in to it stays with{' '}
      {registry.type === 'oci' ? 'Docker' : registry.type === 'pypi' ? 'uv' : registry.type === 'nuget' ? 'NuGet' : 'npm'}.
      {registry.type === 'npm' && !registry.scope && ' The whole download goes through it, so it must also mirror npmjs.org.'}
      <LoginHint registry={registry} lead="If you haven't signed in to it yet:" />
    </Callout>
  );
}

export function HealthPanel({ result, spec, onResult }: { result: HealthResult; spec?: ServerSpec; onResult: (r: HealthResult) => void }) {
  if (!result.ok && result.unreachable) {
    return (
      <Callout tone="warn" icon={<WifiOff className="size-4" />}>
        <div className="font-medium">Not reachable from this network</div>
        <div className="break-words">{sentence(result.error)}</div>
        <div className="mt-1">
          {result.download ? registryUnreachableAdvice(result.unreachable.host, result.privateNetwork) : unreachableAdvice(result.unreachable.host, result.privateNetwork)}
        </div>
        <ShowLog />
      </Callout>
    );
  }
  if (!result.ok) {
    const signIn = result.download?.registry && (result.download.cause === 'sign-in' || (result.download.cause === 'not-found' && !result.download.dependency));
    return (
      <Callout tone="danger" icon={<XCircle className="size-4" />}>
        <div className="font-medium">{result.download ? "Couldn't download the package" : 'Connection failed'}</div>
        <div className="break-words">{sentence(result.error)}</div>
        {signIn && <LoginHint registry={result.download!.registry!} />}
        {result.privateNetwork && (
          <div className="mt-1">
            This server only works on {result.privateNetwork.vpn ?? 'a private network'}
            {privateNetworkDetail(result.privateNetwork)}. If you're not connected, that may be why.
          </div>
        )}
        {result.stderr && <pre className="mt-2 max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap opacity-80">{result.stderr}</pre>}
        <ShowLog />
      </Callout>
    );
  }
  if (result.signIn && spec) return <SignInPanel result={result} spec={spec} onResult={onResult} />;
  return (
    <Callout tone="ok" icon={<CheckCircle2 className="size-4" />}>
      <div className="font-medium">
        Connected to {result.serverName ?? 'server'} {result.serverVersion && `v${result.serverVersion}`} in {(result.durationMs / 1000).toFixed(1)}s
      </div>
      {result.tools.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {result.tools.slice(0, 40).map((t) => (
            <span key={t.name} title={t.description} className="rounded bg-panel/70 px-1.5 py-0.5 font-mono text-[11px] text-ink">
              {t.name}
            </span>
          ))}
          {result.tools.length > 40 && <span className="text-xs">+{result.tools.length - 40} more</span>}
        </div>
      ) : (
        <div>The server exposes no tools.</div>
      )}
    </Callout>
  );
}

function compat(client: ClientInfo, spec: ServerSpec | undefined): 'ok' | 'bridged' | 'unsupported' {
  if (!spec) return 'ok';
  if (client.transports.includes(spec.transport)) return 'ok';
  if (client.bridgedTransports.includes(spec.transport)) return 'bridged';
  return 'unsupported';
}

/** Downloading an `mcpb` bundle, why it failed, or which bundle the settings come from. */
function BundleStatus({ bundle, needs }: { bundle: ReturnType<typeof useQuery<PreparedBundle>>; needs?: string }) {
  if (bundle.isFetching && !bundle.data) return <Spinner label="Downloading the bundle and checking its hash…" />;
  if (bundle.error) {
    return (
      <Callout tone="danger" icon={<XCircle className="size-4" />}>
        <div className="font-medium">Couldn't get the bundle</div>
        <div className="break-words">{sentence(errorMessage(bundle.error))}</div>
        <div className="mt-2">
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void bundle.refetch()}>
            Try again
          </Button>
        </div>
      </Callout>
    );
  }
  if (!bundle.data) return null;
  const { manifest } = bundle.data;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <Package className="size-3.5 shrink-0" />
      {/* One span, so the flex gap doesn't split the sentence. */}
      <span>
        Bundle {manifest.display_name ?? manifest.name} {manifest.version}, checked against the registry's hash.
        {needs && (
          <>
            {' '}
            Needs <span className="font-mono">{needs}</span>.
          </>
        )}
      </span>
    </p>
  );
}

export function InstallWizard({ source, onClose, onViewInstalled }: { source: WizardSource; onClose: () => void; onViewInstalled: () => void }) {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clientsList });
  const runtimes = useRuntimes();
  const settings = useSettings();

  const [step, setStep] = useState<Step>('configure');
  const isEdit = !!source.edit;

  // Registry variant state
  const server = source.kind === 'registry' ? source.server : undefined;
  const variants = useMemo(() => (server ? getVariants(server) : []), [server]);
  const [variantIdx, setVariantIdx] = useState(() => {
    if (source.kind !== 'registry') return 0;
    const ref = source.edit?.variantRef;
    const i = ref ? variants.findIndex((v) => v.ref.kind === ref.kind && v.ref.index === ref.index) : -1;
    // App checks runtimes at launch, so they're usually known by now; if not, the ranking just can't prefer installed ones.
    const installed = runtimes.data && new Set(runtimes.data.filter((r) => r.path).map((r) => r.name));
    return i >= 0 ? i : Math.max(0, variants.indexOf(defaultVariant(variants, installed)!));
  });
  const listed = variants[variantIdx];
  // An `mcpb` variant gets its settings and command from the bundle, so it's downloaded as soon as it's picked.
  const bundleSource = listed && !listed.unsupported ? listed.bundle : undefined;
  const bundle = useQuery({
    queryKey: ['bundle', bundleSource?.sha256],
    queryFn: () => api.bundlePrepare(bundleSource!.url, bundleSource!.sha256),
    enabled: !!bundleSource,
    staleTime: Infinity,
    retry: false,
  });
  const variant = useMemo(() => (listed?.bundle && bundle.data ? bundleVariant(listed, bundle.data) : listed), [listed, bundle.data]);
  const [name, setName] = useState(() => (source.kind === 'registry' ? (source.edit?.name ?? suggestName(source.server)) : ''));
  const [values, setValues] = useState<FormValues>(() =>
    source.kind === 'registry' && source.edit ? { ...(variant ? initialValues(variant) : {}), ...source.edit.values } : variant ? initialValues(variant) : {},
  );
  const [showErrors, setShowErrors] = useState(false);
  // The bundle's defaults are only known once it's downloaded; values already set (an edit's) win.
  useEffect(() => {
    if (variant?.bundle && bundle.data) setValues((prev) => ({ ...initialValues(variant), ...prev }));
  }, [bundle.data, variantIdx]); // only when a bundle arrives, not on every edit

  // Custom server state
  const [custom, setCustom] = useState<CustomForm>(() => customFormFromSpec(source.kind === 'custom' ? source.spec : undefined));

  const initialTargets = source.kind === 'registry' ? source.edit?.targets : source.targets;
  const [targets, setTargets] = useState<Partial<Record<ClientId, TargetState>>>(() =>
    Object.fromEntries((initialTargets ?? []).map((t) => [t.clientId, { selected: true, scope: t.scope.kind, projectDir: t.scope.projectDir }])),
  );
  const [secretsMode, setSecretsMode] = useState<SecretsMode | undefined>(source.kind === 'registry' ? source.edit?.secretsMode : undefined);
  const effectiveSecretsMode: SecretsMode = secretsMode ?? settings.data?.defaultSecretsMode ?? 'inline';

  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);

  const fieldErrors = variant ? validateValues(variant, values) : {};
  const resolved = useMemo((): { spec?: ServerSpec; error?: string } => {
    if (source.kind === 'custom') return specFromCustomForm(custom);
    if (!variant || variant.unsupported) return { error: variant?.unsupported ?? 'No installable variant.' };
    if (variant.bundle && !bundle.data) return { error: bundle.error ? errorMessage(bundle.error) : 'Downloading the bundle…' };
    const res = resolveVariant(source.server, variant.ref, name, values, bundle.data);
    return res.ok ? { spec: res.spec } : { error: res.error };
  }, [source, custom, variant, name, values, bundle.data, bundle.error]);
  const spec = resolved.spec;
  const hasSecrets = !!(spec?.secretEnv?.length || spec?.secretHeaders?.length);
  const runtime = variant?.runtime ? runtimes.data?.find((r) => r.name === variant.runtime) : undefined;
  // Only the runtime on Kumi's PATH is known; with nvm, fnm or pyenv, apps may run another one. So this only warns.
  const runtimeTooOld = !!(runtime?.version && variant?.runtimeRange && satisfies(runtime.version, variant.runtimeRange) === false);
  // Apps that reach hosted servers through mcp-remote need npx for them, even though nothing else runs locally.
  const npx = runtimes.data?.find((r) => r.name === 'npx');
  const bridgeMissingNpx = !!npx && !npx.path && !!clients.data?.some((c) => compat(c, spec) === 'bridged');
  useRecheckRuntimesOnFocus((!!runtime && !runtime.path) || bridgeMissingNpx);
  const registryFlag = server ? registryPrivateNetwork(server) : undefined;
  const privateNetwork = privateNetworkFor(registryFlag, [spec?.url], settings.data);

  const clientOrder = (id: string) => clients.data?.findIndex((c) => c.id === id) ?? 0;
  const selectedTargets: InstallTarget[] = Object.entries(targets)
    .filter(([, t]) => t?.selected)
    .sort(([a], [b]) => clientOrder(a) - clientOrder(b))
    .map(([clientId, t]) => ({ clientId: clientId as ClientId, scope: { kind: t!.scope, ...(t!.scope !== 'user' ? { projectDir: t!.projectDir } : {}) } }));
  const targetsMissingDir = selectedTargets.some((t) => t.scope.kind !== 'user' && !t.scope.projectDir);
  // A bundle's config points at a folder on this machine, so it can't go in a config shared through the repo.
  const isBundle = !!variant?.bundle;
  const bundleInProject = isBundle && selectedTargets.some((t) => t.scope.kind === 'project');

  const test = useMutation({ mutationFn: (s: ServerSpec) => api.healthTest(s, { privateNetwork: registryFlag }), onSuccess: setHealth, onError: (e) => setHealth({ ok: false, tools: [], error: errorMessage(e), durationMs: 0 }) });

  const buildRequest = (overwriteForeign: boolean): InstallRequest => {
    const secretKeys = variant?.fields.filter((f) => f.secret).map((f) => f.id) ?? [];
    return {
      spec: spec!,
      targets: selectedTargets,
      secretsMode: effectiveSecretsMode,
      overwriteForeign: overwriteForeign || undefined,
      ...(source.kind === 'registry' && variant
        ? {
            source: {
              registryId: source.registryId,
              registryName: source.server.name,
              version: source.server.version,
              variant: variant.ref,
              ...(registryFlag ? { privateNetwork: registryFlag } : {}),
            },
            values,
            secretValueKeys: secretKeys,
          }
        : { source: undefined }),
    };
  };

  const planMutation = useMutation({
    mutationFn: (overwriteForeign: boolean) => api.installPlan(buildRequest(overwriteForeign)),
    onSuccess: (p) => {
      setPlan(p);
      setStep('review');
    },
  });
  const applyMutation = useMutation({
    mutationFn: (planId: string) => api.installApply(planId),
    onSuccess: (r) => {
      setResults(r);
      setStep('done');
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const title = source.kind === 'registry' ? (
    <div className="flex items-center gap-3">
      <ServerIcon server={source.server} size={28} />
      <span>
        {isEdit ? 'Edit' : 'Install'} {displayName(source.server)}
      </span>
    </div>
  ) : isEdit ? (
    `Edit ${custom.name}`
  ) : (
    'Add a custom server'
  );

  const applicableChanges = plan?.changes.filter((c) => !c.error) ?? [];
  const foreignBlocked = plan?.changes.some((c) => c.error && /wasn't installed by Kumi/.test(c.error));

  let footer;
  if (step === 'configure') {
    const blocked = !spec || (Object.keys(fieldErrors).length > 0);
    footer = (
      <>
        <Button
          icon={<PlugZap className="size-4" />}
          disabled={!spec}
          loading={test.isPending}
          onClick={() => {
            setHealth(null);
            test.mutate(spec!);
          }}
        >
          Test connection
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setShowErrors(true);
            if (!blocked) setStep('targets');
          }}
        >
          Continue
        </Button>
      </>
    );
  } else if (step === 'targets') {
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('configure')}>
          Back
        </Button>
        <div className="flex-1" />
        <Button
          variant="primary"
          disabled={!selectedTargets.length || targetsMissingDir || bundleInProject}
          loading={planMutation.isPending}
          onClick={() => planMutation.mutate(overwrite)}
        >
          Review changes
        </Button>
      </>
    );
  } else if (step === 'review') {
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('targets')}>
          Back
        </Button>
        <div className="flex-1" />
        <Button variant="primary" disabled={!applicableChanges.length} loading={applyMutation.isPending} onClick={() => applyMutation.mutate(plan!.id)}>
          {isEdit ? 'Save changes' : `Install to ${applicableChanges.length} app${applicableChanges.length === 1 ? '' : 's'}`}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        {spec && (
          <Button icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate(spec)}>
            Test connection
          </Button>
        )}
        <div className="flex-1" />
        <Button onClick={onViewInstalled}>View installed</Button>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }

  return (
    <Modal title={title} onClose={onClose} footer={footer} wide>
      <div className="mb-5">
        <Steps current={step} />
      </div>

      {step === 'configure' && (
        <div className="space-y-5">
          {source.kind === 'registry' ? (
            <>
              {variants.length > 1 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">How to run it</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {variants.map((v, i) => (
                      <button
                        key={`${v.ref.kind}-${v.ref.index}`}
                        type="button"
                        disabled={!!v.unsupported || isEdit}
                        title={v.unsupported}
                        onClick={() => {
                          setVariantIdx(i);
                          setValues(initialValues(v));
                          setShowErrors(false);
                          setHealth(null);
                        }}
                        className={cx(
                          'rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
                          i === variantIdx ? 'border-accent bg-accent-soft/50 ring-1 ring-accent' : 'border-line hover:bg-sunken',
                        )}
                      >
                        <div className="truncate font-mono text-[12px]" title={v.bundle?.url}>
                          {v.label}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Badge>{v.ref.kind === 'remote' ? 'hosted' : 'runs locally'}</Badge>
                          <Badge>{v.transport}</Badge>
                          {v.runtime && <Badge>{v.runtime}</Badge>}
                          {v.unsupported && <Badge tone="warn">not supported</Badge>}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {runtime && !runtime.path && (
                <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
                  <span className="font-mono">{runtime.name}</span> wasn't found on this machine. {runtime.installHint}
                </Callout>
              )}

              {variant?.bundle && <BundleStatus bundle={bundle} needs={variant.runtime && variant.runtimeRange ? `${variant.runtime} ${variant.runtimeRange}` : undefined} />}
              {runtimeTooOld && (
                <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
                  The <span className="font-mono">{runtime!.name}</span> on your PATH is {runtime!.version}; this bundle needs{' '}
                  <span className="font-mono">{variant!.runtimeRange}</span>. If you switch versions with a version manager (nvm, fnm, pyenv…), make sure the one your
                  apps use is new enough.
                </Callout>
              )}
              {variant?.bundle && variant.unsupported && (
                <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
                  {variant.unsupported}
                </Callout>
              )}

              <section className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-[13px] font-medium">Server name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit} className="font-mono" />
                  <span className="text-xs text-muted">The key used in each app's config.</span>
                </label>
                {variant?.fields.length ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {variant.fields.map((f) => (
                      <FieldInput
                        key={f.id}
                        field={f}
                        value={values[f.id] ?? ''}
                        error={showErrors ? fieldErrors[f.id] : undefined}
                        onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
                      />
                    ))}
                  </div>
                ) : variant?.bundle && !bundle.data ? null : (
                  <p className="text-sm text-muted">This server needs no settings.</p>
                )}
              </section>
            </>
          ) : (
            <CustomServerForm form={custom} onChange={setCustom} nameLocked={isEdit} />
          )}

          {showErrors && resolved.error && Object.keys(fieldErrors).length === 0 && !(variant?.bundle && !bundle.data) && (
            <Callout tone="danger" icon={<XCircle className="size-4" />}>
              {resolved.error}
            </Callout>
          )}
          {privateNetwork && (
            <Callout tone="accent" icon={<Network className="size-4" />}>
              Only reachable on {privateNetwork.vpn ?? 'a private network'}
              {privateNetworkDetail(privateNetwork)}. Testing fails unless you're connected; your apps can use it once you are.
            </Callout>
          )}
          {source.kind === 'registry' && variant?.privateRegistry && (
            <PrivateRegistryNote
              registry={variant.privateRegistry}
              passed={variant.ref.kind === 'package' && !!source.server.packages?.[variant.ref.index] && canPassRegistry(source.server.packages[variant.ref.index]!)}
            />
          )}
          {source.kind === 'registry' && variant?.warning && (
            <Callout tone="warn" icon={<AlertTriangle className="size-4" />}>
              {variant.warning}
            </Callout>
          )}
          {spec && (
            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted">What will run</summary>
              <pre className="overflow-x-auto px-3 pb-3 font-mono text-[12px] whitespace-pre-wrap">
                {spec.transport === 'stdio' ? [spec.command, ...(spec.args ?? []).map((a, i) => (spec.secretArgs?.includes(i) ? '••••' : a))].join(' ') : `${spec.transport} → ${spec.url}`}
              </pre>
            </details>
          )}
          {health && <HealthPanel result={health} spec={spec} onResult={setHealth} />}
          {test.isPending && <Spinner label={testingLabel(spec, true)} />}
        </div>
      )}

      {step === 'targets' && (
        <div className="space-y-5">
          {clients.isLoading && <Spinner label="Looking for installed apps…" />}
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {clients.data?.map((c) => {
              const t = targets[c.id] ?? { selected: false, scope: c.scopes.find((s) => !(isBundle && s === 'project')) ?? c.scopes[0] };
              const support = compat(c, spec);
              const update = (patch: Partial<TargetState>) => setTargets((prev) => ({ ...prev, [c.id]: { ...t, ...patch } }));
              return (
                <div key={c.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', support === 'unsupported' && 'opacity-50')}>
                  <label className="flex min-w-56 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={t.selected}
                      disabled={support === 'unsupported'}
                      onChange={(e) => update({ selected: e.target.checked })}
                    />
                    <ClientMark id={c.id} />
                    <span className="font-medium">{c.displayName}</span>
                    {!c.detected && <Badge>not detected</Badge>}
                    {support === 'bridged' && (
                      <Badge tone="warn" title="Connected through the mcp-remote stdio bridge">
                        via mcp-remote
                      </Badge>
                    )}
                    {support === 'unsupported' && <Badge tone="danger">not supported</Badge>}
                  </label>
                  {support === 'bridged' && npx && !npx.path && (
                    <p className="order-last flex w-full items-start gap-1.5 text-xs text-warn">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      <span>
                        {c.displayName} needs <span className="font-mono">npx</span> for hosted servers, and it wasn't found on this machine. {npx.installHint}
                      </span>
                    </p>
                  )}
                  {t.selected && (
                    <div className="flex items-center gap-2">
                      {c.scopes.length > 1 && (
                        <select
                          className="h-8 rounded-lg border border-line bg-panel px-2 text-xs"
                          value={t.scope}
                          onChange={(e) => update({ scope: e.target.value as ScopeKind })}
                          title={SCOPE_TEXT[t.scope]}
                        >
                          {c.scopes.map((s) => (
                            <option key={s} value={s} disabled={isBundle && s === 'project'}>
                              {SCOPE_TEXT[s]}
                              {isBundle && s === 'project' ? ' (not for bundles)' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      {t.scope !== 'user' && (
                        <Button
                          size="sm"
                          icon={<FolderOpen className="size-3.5" />}
                          onClick={async () => {
                            const dir = await api.pickDirectory();
                            if (dir) update({ projectDir: dir });
                          }}
                          className={cx(!t.projectDir && 'border-accent text-accent')}
                        >
                          {t.projectDir ? scopeLabel({ kind: t.scope, projectDir: t.projectDir }).split(' · ')[1] : 'Choose folder…'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isBundle && clients.data?.some((c) => c.scopes.includes('project')) && (
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <Package className="mt-px size-3.5 shrink-0" />
              <span>
                Bundles can't go in a project config: it would point at the folder Kumi unpacked the bundle to on this machine, which teammates don't have.
                Use the global or local scope.
              </span>
            </p>
          )}

          {hasSecrets && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Secrets</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['inline', 'Write into config files', 'Works in every app. Values are stored in plain text, the same as setting it up by hand.'],
                    ['client-native', "Use the app's secure storage", 'VS Code asks for each secret once and keeps it in its own secret storage. Other apps fall back to config files.'],
                  ] as const
                ).map(([mode, label, help]) => (
                  <label key={mode} className={cx('cursor-pointer rounded-xl border p-3', effectiveSecretsMode === mode ? 'border-accent ring-1 ring-accent' : 'border-line')}>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <input type="radio" className="accent-accent" checked={effectiveSecretsMode === mode} onChange={() => setSecretsMode(mode)} />
                      {label}
                    </div>
                    <p className="mt-1 text-xs text-muted">{help}</p>
                  </label>
                ))}
              </div>
            </section>
          )}

          {planMutation.error && (
            <Callout tone="danger" icon={<XCircle className="size-4" />}>
              {errorMessage(planMutation.error)}
            </Callout>
          )}
        </div>
      )}

      {step === 'review' && plan && (
        <div className="space-y-4">
          <p className="text-sm text-muted">These are the exact edits Kumi will make. Each file is backed up first; secrets are hidden here.</p>
          {plan.changes.map((c) => {
            const client = clients.data?.find((x) => x.id === c.clientId);
            return (
              <section key={`${c.clientId}-${c.scope.kind}-${c.scope.projectDir ?? ''}`} className="space-y-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ClientMark id={c.clientId} />
                  <span className="font-medium">{client?.displayName ?? c.clientId}</span>
                  <Badge>{scopeLabel(c.scope)}</Badge>
                  {c.replaces && !c.error && <Badge tone="warn">replaces existing</Badge>}
                  <span className="ml-auto truncate font-mono text-[11px] text-muted" title={c.configPath}>
                    {c.configPath}
                  </span>
                </div>
                {c.error ? (
                  <Callout tone="danger" icon={<XCircle className="size-4" />}>
                    {c.error}
                  </Callout>
                ) : (
                  <>
                    {c.warnings.map((w) => (
                      <Callout key={w} tone="warn" icon={<AlertTriangle className="size-4" />}>
                        {w}
                      </Callout>
                    ))}
                    <DiffView lines={c.diff} />
                  </>
                )}
              </section>
            );
          })}
          {foreignBlocked && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={overwrite}
                onChange={(e) => {
                  setOverwrite(e.target.checked);
                  planMutation.mutate(e.target.checked);
                }}
              />
              Replace existing servers with the same name that Kumi didn't install
            </label>
          )}
          {applyMutation.error && (
            <Callout tone="danger" icon={<XCircle className="size-4" />}>
              {errorMessage(applyMutation.error)}
            </Callout>
          )}
        </div>
      )}

      {step === 'done' && results && (
        <div className="space-y-3">
          {results.map((r) => {
            const client = clients.data?.find((x) => x.id === r.clientId);
            return (
              <div key={r.configPath} className="flex items-start gap-3 rounded-xl border border-line p-3">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-5 text-ok" /> : <XCircle className="mt-0.5 size-5 text-danger" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {client?.displayName ?? r.clientId} {r.ok ? (isEdit ? 'updated' : 'is ready') : 'failed'}
                  </div>
                  {r.error && <div className="text-sm text-danger">{r.error}</div>}
                  {r.ok && r.needsRestart && (
                    <div className="mt-1 flex items-center gap-1 text-sm text-warn">
                      <RotateCcw className="size-3.5" /> Restart {client?.displayName} to load it.
                    </div>
                  )}
                  <div className="mt-1 truncate font-mono text-[11px] text-muted">{r.configPath}</div>
                </div>
              </div>
            );
          })}
          {health && <HealthPanel result={health} spec={spec} onResult={setHealth} />}
          {test.isPending && <Spinner label={testingLabel(spec)} />}
        </div>
      )}
    </Modal>
  );
}
