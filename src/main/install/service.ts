// Plan → preview → apply. Plans hold the exact text to write plus a hash of what they were computed from,
// so a file that changed in between is never overwritten blindly.

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type {
  ApplyResult,
  ClientId,
  InstallPlan,
  InstallRecord,
  InstallRequest,
  InstalledEntry,
  InstalledView,
  PlannedChange,
  ScopeRef,
} from '@shared/types';
import { maskSpec, secretValues, SERVER_NAME_PATTERN } from '@shared/variants';
import { ADAPTERS, getAdapter } from '../clients';
import type { HostEnv } from '../clients/types';
import { lineDiff } from '../config-io/diff';
import { atomicWrite, hashText, readTextOrNull } from '../config-io/fs';
import type { BackupService } from '../state/backups';
import { recordKey, type StateStore } from '../state/store';
import type { SecretBox } from '../secrets/secrets';

const MASK = '••••••••';

/** One file write; several targets can share a file (e.g. Claude Code user + local scope in ~/.claude.json). */
interface PendingWrite {
  clientId: ClientId;
  scopes: ScopeRef[];
  configPath: string;
  beforeHash: string;
  text: string;
  /** Same edits applied with secrets masked, for chaining previews. */
  preview: string;
}

interface StoredPlan {
  request: InstallRequest;
  writes: PendingWrite[];
  createdAt: number;
}

const PLAN_TTL_MS = 30 * 60 * 1000;

function scrub(text: string, secrets: string[]): string {
  return secrets.reduce((t, s) => t.split(s).join(MASK), text);
}

function validateScope(clientId: ClientId, scope: ScopeRef) {
  const adapter = getAdapter(clientId);
  if (!adapter.scopes.includes(scope.kind)) throw new Error(`${adapter.displayName} has no "${scope.kind}" scope`);
  if (scope.kind !== 'user' && (!scope.projectDir || !isAbsolute(scope.projectDir))) {
    throw new Error('Pick a project folder for this scope');
  }
}

export class InstallService {
  private plans = new Map<string, StoredPlan>();

  constructor(
    private readonly env: HostEnv,
    private readonly state: StateStore,
    private readonly backups: BackupService,
    private readonly secrets: SecretBox,
  ) {}

  async plan(request: InstallRequest): Promise<InstallPlan> {
    const { spec } = request;
    if (!SERVER_NAME_PATTERN.test(spec.name)) throw new Error('Server name may only contain letters, digits, "-" and "_".');
    const writes = new Map<string, PendingWrite>();
    const changes: PlannedChange[] = [];
    const masked = maskSpec(spec, MASK);
    const commandMissing = spec.transport === 'stdio' && spec.command && !(await this.env.which(spec.command));

    for (const { clientId, scope } of request.targets) {
      const adapter = getAdapter(clientId);
      const change: PlannedChange = { clientId, scope, configPath: '', replaces: false, foreign: false, warnings: [], diff: [] };
      changes.push(change);
      try {
        validateScope(clientId, scope);
        const configPath = adapter.configPath(this.env, scope);
        change.configPath = configPath;
        const pending = writes.get(configPath);
        const original = pending ? null : await readTextOrNull(configPath);
        const before = pending ? pending.text : original;
        const beforePreview = pending ? pending.preview : (original ?? '');
        const existing = adapter.readServers(before ?? '', scope);
        change.replaces = spec.name in existing;
        const owned = await this.state.find(recordKey({ clientId, configPath, scope, name: spec.name }));
        change.foreign = change.replaces && !owned;
        if (change.foreign && !request.overwriteForeign) {
          throw new Error(`"${spec.name}" already exists in this config and wasn't installed by Kumi. Pick another name, or allow replacing it.`);
        }

        const opts = { secretsMode: request.secretsMode, platform: this.env.platform };
        const { text, warnings } = adapter.upsert(before ?? '', spec, scope, opts);
        const preview = adapter.upsert(beforePreview, masked, scope, opts).text;
        change.diff = lineDiff(beforePreview, preview).map((l) => ({ ...l, text: scrub(l.text, secretValues(spec)) }));
        change.warnings.push(...warnings);
        if (commandMissing && !warnings.length) change.warnings.push(`"${spec.command}" was not found on this machine. Install it before using this server.`);
        if (request.secretsMode === 'client-native' && !adapter.supportsSecureSecrets && (spec.secretEnv?.length || spec.secretHeaders?.length)) {
          change.warnings.push(`${adapter.displayName} has no secure secret storage; secrets are written to its config file.`);
        }
        if (adapter.needsRestart) change.warnings.push(`Restart ${adapter.displayName} to load the change.`);
        if (pending) Object.assign(pending, { text, preview, scopes: [...pending.scopes, scope] });
        else writes.set(configPath, { clientId, scopes: [scope], configPath, beforeHash: hashText(original), text, preview });
      } catch (e) {
        change.error = (e as Error).message;
      }
    }

    this.prune();
    const id = randomUUID();
    this.plans.set(id, { request, writes: [...writes.values()], createdAt: Date.now() });
    return { id, serverName: spec.name, changes };
  }

  private prune() {
    const now = Date.now();
    for (const [id, p] of this.plans) if (now - p.createdAt > PLAN_TTL_MS) this.plans.delete(id);
  }

  async apply(planId: string): Promise<ApplyResult[]> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error('This preview expired. Review the changes again.');
    this.plans.delete(planId);
    const { request } = plan;
    const results: ApplyResult[] = [];

    for (const w of plan.writes) {
      const adapter = getAdapter(w.clientId);
      const result: ApplyResult = { clientId: w.clientId, configPath: w.configPath, ok: false, needsRestart: adapter.needsRestart };
      results.push(result);
      try {
        const current = await readTextOrNull(w.configPath);
        if (hashText(current) !== w.beforeHash) throw new Error('The config file changed since the preview. Review the changes again.');
        result.backupPath = (await this.backups.create(w.clientId, w.configPath, current)).backupPath;
        await atomicWrite(w.configPath, w.text);
        const written = (await readTextOrNull(w.configPath)) ?? '';
        for (const scope of w.scopes) {
          if (!(request.spec.name in adapter.readServers(written, scope))) throw new Error('Wrote the file, but the server is missing when read back.');
          await this.state.upsert(await this.record(request, w, scope));
        }
        result.ok = true;
      } catch (e) {
        result.error = (e as Error).message;
      }
    }
    return results;
  }

  private async record(request: InstallRequest, w: PendingWrite, scope: ScopeRef): Promise<InstallRecord> {
    const key = recordKey({ clientId: w.clientId, configPath: w.configPath, scope, name: request.spec.name });
    const existing = await this.state.find(key);
    const now = new Date().toISOString();
    const values = { ...(request.values ?? {}) };
    const secret: Record<string, string> = {};
    for (const k of request.secretValueKeys ?? []) {
      if (k in values) {
        secret[k] = values[k];
        delete values[k];
      }
    }
    const hasSecrets = Object.keys(secret).length > 0;
    return {
      id: existing?.id ?? randomUUID(),
      name: request.spec.name,
      clientId: w.clientId,
      scope,
      configPath: w.configPath,
      source: request.source,
      values,
      encryptedSecrets: hasSecrets && (await this.secrets.available()) ? await this.secrets.encrypt(JSON.stringify(secret)) : undefined,
      secretsMode: request.secretsMode,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };
  }

  /** Form values of an install, secrets included, for editing it. */
  async recordValues(recordId: string): Promise<Record<string, string>> {
    const record = await this.state.findById(recordId);
    if (!record) throw new Error('Install record not found');
    let secret: Record<string, string> = {};
    if (record.encryptedSecrets && (await this.secrets.available())) {
      try {
        secret = JSON.parse(await this.secrets.decrypt(record.encryptedSecrets));
      } catch {
        secret = {};
      }
    }
    return { ...record.values, ...secret };
  }

  async uninstall(target: { clientId: ClientId; scope: ScopeRef; name: string }, force = false): Promise<ApplyResult> {
    const adapter = getAdapter(target.clientId);
    validateScope(target.clientId, target.scope);
    const configPath = adapter.configPath(this.env, target.scope);
    const result: ApplyResult = { clientId: target.clientId, configPath, ok: false, needsRestart: adapter.needsRestart };
    try {
      const key = recordKey({ ...target, configPath });
      const owned = await this.state.find(key);
      if (!owned && !force) throw new Error(`"${target.name}" wasn't installed by Kumi. Confirm to remove it anyway.`);
      const before = await readTextOrNull(configPath);
      if (before !== null && target.name in adapter.readServers(before, target.scope)) {
        const after = adapter.remove(before, target.name, target.scope);
        result.backupPath = (await this.backups.create(target.clientId, configPath, before)).backupPath;
        await atomicWrite(configPath, after);
      }
      await this.state.remove(key);
      result.ok = true;
    } catch (e) {
      result.error = (e as Error).message;
    }
    return result;
  }

  /** Every server in every known config, marked with Kumi's record when we own it. */
  async listInstalled(): Promise<InstalledView> {
    const records = await this.state.records();
    const projects = await this.state.projects();
    const view: InstalledView = { entries: [], errors: [], projects };
    const byKey = new Map(records.map((r) => [recordKey(r), r]));

    for (const adapter of ADAPTERS) {
      const scopes: ScopeRef[] = [];
      if (adapter.scopes.includes('user')) scopes.push({ kind: 'user' });
      for (const dir of projects) {
        if (adapter.scopes.includes('project')) scopes.push({ kind: 'project', projectDir: dir });
        if (adapter.scopes.includes('local')) scopes.push({ kind: 'local', projectDir: dir });
      }
      for (const scope of scopes) {
        const configPath = adapter.configPath(this.env, scope);
        try {
          const text = await readTextOrNull(configPath);
          if (text === null) continue;
          for (const [name, spec] of Object.entries(adapter.readServers(text, scope))) {
            const entry: InstalledEntry = { clientId: adapter.id, scope, configPath, name, spec, record: byKey.get(recordKey({ clientId: adapter.id, configPath, scope, name })) };
            view.entries.push(entry);
          }
        } catch (e) {
          view.errors.push({ clientId: adapter.id, scope, configPath, error: (e as Error).message });
        }
      }
    }
    return view;
  }
}
