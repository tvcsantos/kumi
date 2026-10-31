import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, FolderOpen, PlugZap, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { ClientMark, DiffView, displayName, scopeLabel, ServerIcon } from './bits';
import { CustomServerForm, customFormFromSpec, specFromCustomForm, type CustomForm } from './CustomServerForm';
import { FieldInput } from './FieldInput';
import { Badge, Button, Callout, Input, Modal, Spinner, cx } from './ui';

export type WizardSource =
  | {
      kind: 'registry';
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

export function HealthPanel({ result }: { result: HealthResult }) {
  if (!result.ok) {
    return (
      <Callout tone="danger" icon={<XCircle className="size-4" />}>
        <div className="font-medium">Connection failed</div>
        <div className="break-words">{result.error}</div>
        {result.stderr && <pre className="mt-2 max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap opacity-80">{result.stderr}</pre>}
      </Callout>
    );
  }
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

export function InstallWizard({ source, onClose, onViewInstalled }: { source: WizardSource; onClose: () => void; onViewInstalled: () => void }) {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clientsList });
  const runtimes = useQuery({ queryKey: ['runtimes'], queryFn: api.runtimesCheck });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settingsGet });

  const [step, setStep] = useState<Step>('configure');
  const isEdit = !!source.edit;

  // Registry variant state
  const server = source.kind === 'registry' ? source.server : undefined;
  const variants = useMemo(() => (server ? getVariants(server) : []), [server]);
  const [variantIdx, setVariantIdx] = useState(() => {
    if (source.kind !== 'registry') return 0;
    const ref = source.edit?.variantRef;
    const i = ref ? variants.findIndex((v) => v.ref.kind === ref.kind && v.ref.index === ref.index) : -1;
    return i >= 0 ? i : Math.max(0, variants.indexOf(defaultVariant(variants)!));
  });
  const variant = variants[variantIdx];
  const [name, setName] = useState(() => (source.kind === 'registry' ? (source.edit?.name ?? suggestName(source.server)) : ''));
  const [values, setValues] = useState<FormValues>(() =>
    source.kind === 'registry' && source.edit ? { ...(variant ? initialValues(variant) : {}), ...source.edit.values } : variant ? initialValues(variant) : {},
  );
  const [showErrors, setShowErrors] = useState(false);

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
    const res = resolveVariant(source.server, variant.ref, name, values);
    return res.ok ? { spec: res.spec } : { error: res.error };
  }, [source, custom, variant, name, values]);
  const spec = resolved.spec;
  const hasSecrets = !!(spec?.secretEnv?.length || spec?.secretHeaders?.length);
  const runtime = variant?.runtime ? runtimes.data?.find((r) => r.name === variant.runtime) : undefined;

  const clientOrder = (id: string) => clients.data?.findIndex((c) => c.id === id) ?? 0;
  const selectedTargets: InstallTarget[] = Object.entries(targets)
    .filter(([, t]) => t?.selected)
    .sort(([a], [b]) => clientOrder(a) - clientOrder(b))
    .map(([clientId, t]) => ({ clientId: clientId as ClientId, scope: { kind: t!.scope, ...(t!.scope !== 'user' ? { projectDir: t!.projectDir } : {}) } }));
  const targetsMissingDir = selectedTargets.some((t) => t.scope.kind !== 'user' && !t.scope.projectDir);

  const test = useMutation({ mutationFn: (s: ServerSpec) => api.healthTest(s), onSuccess: setHealth, onError: (e) => setHealth({ ok: false, tools: [], error: errorMessage(e), durationMs: 0 }) });

  const buildRequest = (overwriteForeign: boolean): InstallRequest => {
    const secretKeys = variant?.fields.filter((f) => f.secret).map((f) => f.id) ?? [];
    return {
      spec: spec!,
      targets: selectedTargets,
      secretsMode: effectiveSecretsMode,
      overwriteForeign: overwriteForeign || undefined,
      ...(source.kind === 'registry' && variant
        ? {
            source: { registryName: source.server.name, version: source.server.version, variant: variant.ref },
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
        <Button variant="primary" disabled={!selectedTargets.length || targetsMissingDir} loading={planMutation.isPending} onClick={() => planMutation.mutate(overwrite)}>
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
                        <div className="truncate font-mono text-[12px]">{v.label}</div>
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
                ) : (
                  <p className="text-sm text-muted">This server needs no settings.</p>
                )}
              </section>
            </>
          ) : (
            <CustomServerForm form={custom} onChange={setCustom} nameLocked={isEdit} />
          )}

          {showErrors && resolved.error && Object.keys(fieldErrors).length === 0 && (
            <Callout tone="danger" icon={<XCircle className="size-4" />}>
              {resolved.error}
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
          {health && <HealthPanel result={health} />}
          {test.isPending && <Spinner label="Starting the server… (first run may download it)" />}
        </div>
      )}

      {step === 'targets' && (
        <div className="space-y-5">
          {clients.isLoading && <Spinner label="Looking for installed apps…" />}
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {clients.data?.map((c) => {
              const t = targets[c.id] ?? { selected: false, scope: c.scopes[0] };
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
                            <option key={s} value={s}>
                              {SCOPE_TEXT[s]}
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
          {health && <HealthPanel result={health} />}
          {test.isPending && <Spinner label="Starting the server…" />}
        </div>
      )}
    </Modal>
  );
}
