import type { ServerSpec, Transport } from '@shared/types';
import { SERVER_NAME_PATTERN } from '@shared/variants';
import { Input, Select, cx } from './ui';

export interface CustomForm {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const SECRET_KEY = /(key|token|secret|password|passwd|auth|credential|cookie)/i;

export function customFormFromSpec(spec?: ServerSpec): CustomForm {
  return {
    name: spec?.name ?? '',
    transport: spec?.transport ?? 'stdio',
    command: spec?.command ?? '',
    args: (spec?.args ?? []).join('\n'),
    env: Object.entries(spec?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: spec?.url ?? '',
    headers: Object.entries(spec?.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
  };
}

function parsePairs(text: string, sep: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = sep.exec(line);
    if (!m || m.index === 0) continue;
    out[line.slice(0, m.index).trim()] = line.slice(m.index + m[0].length).trim();
  }
  return out;
}

export function specFromCustomForm(f: CustomForm): { spec?: ServerSpec; error?: string } {
  if (!SERVER_NAME_PATTERN.test(f.name)) return { error: 'Name may only contain letters, digits, "-" and "_".' };
  if (f.transport === 'stdio') {
    if (!f.command.trim()) return { error: 'Command is required.' };
    const env = parsePairs(f.env, /=/);
    const secretEnv = Object.keys(env).filter((k) => SECRET_KEY.test(k));
    return {
      spec: {
        name: f.name,
        transport: 'stdio',
        command: f.command.trim(),
        args: f.args.split('\n').map((a) => a.trim()).filter(Boolean),
        ...(Object.keys(env).length ? { env } : {}),
        ...(secretEnv.length ? { secretEnv } : {}),
      },
    };
  }
  try {
    const u = new URL(f.url.trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { error: 'Enter a valid http(s) URL.' };
  }
  const headers = parsePairs(f.headers, /:/);
  const secretHeaders = Object.keys(headers).filter((k) => SECRET_KEY.test(k));
  return {
    spec: {
      name: f.name,
      transport: f.transport,
      url: f.url.trim(),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(secretHeaders.length ? { secretHeaders } : {}),
    },
  };
}

const textarea = 'w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[12px] text-ink focus:border-accent focus:ring-3 focus:ring-accent/12 focus:outline-none';

export function CustomServerForm({ form, onChange, nameLocked }: { form: CustomForm; onChange: (f: CustomForm) => void; nameLocked?: boolean }) {
  const set = <K extends keyof CustomForm>(k: K, v: CustomForm[K]) => onChange({ ...form, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[13px] font-medium">Name</span>
          <Input value={form.name} disabled={nameLocked} onChange={(e) => set('name', e.target.value)} placeholder="my-server" />
        </label>
        <label className="space-y-1">
          <span className="text-[13px] font-medium">Type</span>
          <Select value={form.transport} onChange={(e) => set('transport', e.target.value as Transport)}>
            <option value="stdio">Local command (stdio)</option>
            <option value="streamable-http">Remote (Streamable HTTP)</option>
            <option value="sse">Remote (SSE, legacy)</option>
          </Select>
        </label>
      </div>
      {form.transport === 'stdio' ? (
        <>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Command</span>
            <Input value={form.command} onChange={(e) => set('command', e.target.value)} placeholder="npx" className="font-mono" />
          </label>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Arguments</span>
            <textarea rows={3} className={textarea} value={form.args} onChange={(e) => set('args', e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-memory'} />
            <span className="text-xs text-muted">One per line.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Environment variables</span>
            <textarea rows={3} className={textarea} value={form.env} onChange={(e) => set('env', e.target.value)} placeholder="API_KEY=…" />
            <span className="text-xs text-muted">KEY=value, one per line. Names containing key, token, secret or password are treated as secrets.</span>
          </label>
        </>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">URL</span>
            <Input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/mcp" className="font-mono" />
          </label>
          <label className="block space-y-1">
            <span className="text-[13px] font-medium">Headers</span>
            <textarea rows={3} className={cx(textarea)} value={form.headers} onChange={(e) => set('headers', e.target.value)} placeholder="Authorization: Bearer …" />
            <span className="text-xs text-muted">Name: value, one per line.</span>
          </label>
        </>
      )}
    </div>
  );
}
