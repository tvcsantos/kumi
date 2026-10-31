// Format-preserving TOML editing for one table family (e.g. `[mcp_servers.<name>]` and its sub-tables).
// We only remove whole sections we own and append freshly rendered ones, so the rest of the file stays byte-identical.

import { parse, TomlError } from 'smol-toml';
import { ConfigParseError } from './json';

export type TomlTable = Record<string, unknown>;

export function parseToml(text: string): TomlTable {
  try {
    return parse(text) as TomlTable;
  } catch (e) {
    const msg = e instanceof TomlError ? `line ${e.line}: ${e.message.split('\n')[0]}` : String(e);
    throw new ConfigParseError(`Invalid TOML at ${msg}`);
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}

function tomlString(s: string): string {
  // JSON escapes are a subset of TOML basic-string escapes, except for the few control chars JSON leaves raw.
  return JSON.stringify(s).replace(/[\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function tomlValue(v: unknown): string {
  if (typeof v === 'string') return tomlString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{ ${entries.map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`).join(', ')} }`;
  }
  throw new Error(`Unsupported TOML value: ${String(v)}`);
}

/** Parses the dotted key of a `[table]` or `[[array]]` header line; null if the line isn't a header. */
export function parseHeader(line: string): { keys: string[]; array: boolean } | null {
  const m = /^\s*(\[\[?)(.*?)(\]\]?)\s*(#.*)?$/.exec(line);
  if (!m || m[1].length !== m[3].length) return null;
  const keys: string[] = [];
  let rest = m[2].trim();
  while (rest.length) {
    let km: RegExpExecArray | null;
    if ((km = /^"((?:[^"\\]|\\.)*)"/.exec(rest))) keys.push(JSON.parse(`"${km[1]}"`));
    else if ((km = /^'([^']*)'/.exec(rest))) keys.push(km[1]);
    else if ((km = /^[A-Za-z0-9_-]+/.exec(rest))) keys.push(km[0]);
    else return null;
    rest = rest.slice(km[0].length).trim();
    if (rest.startsWith('.')) rest = rest.slice(1).trim();
    else if (rest.length) return null;
  }
  return { keys, array: m[1] === '[[' };
}

function startsWith(keys: string[], prefix: string[]): boolean {
  return prefix.every((k, i) => keys[i] === k);
}

/**
 * Removes every section whose header starts with `prefix` (e.g. ["mcp_servers", "github"]).
 * Throws if the data is defined some other way (inline table, dotted keys), since we can't remove that safely.
 */
export function removeSections(text: string, prefix: string[]): string {
  const lines = text.split(/(?<=\n)/);
  const out: string[] = [];
  let skipped: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = parseHeader(line);
    if (header) {
      const wasSkipping = skipping;
      skipping = startsWith(header.keys, prefix);
      if (wasSkipping && !skipping) {
        // Comments right above the next header belong to that header, not to the removed section.
        let keepFrom = skipped.length;
        while (keepFrom > 1 && /^\s*(#.*)?\r?\n?$/.test(skipped[keepFrom - 1])) keepFrom--;
        const restored = skipped.slice(keepFrom);
        const prevBlank = out.length === 0 || /^\s*\r?\n$/.test(out[out.length - 1]);
        while (restored.length && prevBlank && /^\s*\r?\n$/.test(restored[0])) restored.shift();
        out.push(...restored);
      }
      skipped = [];
    }
    if (skipping) skipped.push(line);
    else out.push(line);
  }
  // Removing the last section shouldn't leave the blank separator line behind.
  if (skipping) while (out.length > 1 && /^\s*\r?\n$/.test(out[out.length - 1])) out.pop();
  const result = out.join('');
  if (getPath(parseToml(result), prefix) !== undefined) {
    throw new ConfigParseError(`"${prefix.join('.')}" is defined inline in this file; edit it by hand or convert it to a [table].`);
  }
  return result;
}

export function getPath(root: TomlTable, path: string[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as TomlTable)[k];
  }
  return cur;
}

/** Renders `[prefix]` with scalar/array fields, plus `[prefix.sub]` sub-tables for object fields. */
export function renderSection(prefix: string[], table: TomlTable, eol = '\n'): string {
  const head = prefix.map(tomlKey).join('.');
  const scalars: string[] = [];
  const subs: string[] = [];
  for (const [k, v] of Object.entries(table)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const body = Object.entries(v)
        .map(([sk, sv]) => `${tomlKey(sk)} = ${tomlValue(sv)}`)
        .join(eol);
      subs.push(`[${head}.${tomlKey(k)}]${eol}${body}${eol}`);
    } else {
      scalars.push(`${tomlKey(k)} = ${tomlValue(v)}`);
    }
  }
  return [`[${head}]${eol}${scalars.join(eol)}${scalars.length ? eol : ''}`, ...subs].join(eol);
}

/** Replaces (or adds) the section family at `prefix` and appends the new rendering at the end of the file. */
export function upsertSection(text: string, prefix: string[], table: TomlTable): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let base = removeSections(text, prefix);
  if (base.length && !base.endsWith('\n')) base += eol;
  // One blank line between the previous content and our section.
  const sep = base.trim().length === 0 ? '' : base.endsWith(`${eol}${eol}`) ? '' : eol;
  if (base.trim().length === 0) base = '';
  return `${base}${sep}${renderSection(prefix, table, eol)}`;
}
