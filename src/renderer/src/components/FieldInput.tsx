import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { InputField } from '@shared/registry';
import { api } from '../lib/api';
import { Button, Input, Select, cx } from './ui';

export function FieldInput({ field, value, error, onChange }: { field: InputField; value: string; error?: string; onChange: (v: string) => void }) {
  const [reveal, setReveal] = useState(false);
  const id = `field-${field.id}`;

  let control;
  if (field.choices?.length) {
    control = (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!field.required && <option value="">—</option>}
        {field.required && !value && <option value="">Choose…</option>}
        {field.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    );
  } else if (field.format === 'boolean') {
    control = (
      <label className="flex h-9 items-center gap-2 text-sm">
        <input id={id} type="checkbox" className="size-4 accent-accent" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} />
        Enabled
      </label>
    );
  } else {
    control = (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={field.secret && !reveal ? 'password' : 'text'}
            inputMode={field.format === 'number' ? 'numeric' : undefined}
            value={value}
            placeholder={field.placeholder ?? (field.default ? `Default: ${field.default}` : undefined)}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cx(field.secret && 'pr-9', error && 'border-danger')}
          />
          {field.secret && (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted hover:text-ink"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Hide value' : 'Show value'}
            >
              {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
        {field.format === 'filepath' && (
          <Button
            icon={<FolderOpen className="size-4" />}
            onClick={async () => {
              const picked = await api.pickFile();
              if (picked) onChange(picked);
            }}
          >
            Browse
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium">
        <span className="font-mono">{field.label}</span>
        {field.required && <span className="text-spark">*</span>}
        {field.secret && <span className="rounded bg-sunken px-1 text-[10px] font-normal text-muted">secret</span>}
      </label>
      {control}
      {error ? <p className="text-xs text-danger">{error}</p> : field.description && <p className="text-xs text-muted">{field.description}</p>}
    </div>
  );
}
