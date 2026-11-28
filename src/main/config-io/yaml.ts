// Format-preserving YAML editing for one entry of a top-level block mapping (e.g. `mcp_servers.<name>`).
// We only replace or remove the lines of the entry we own and insert a freshly rendered one, so the rest of the
// file stays byte-identical. Anything we can't edit that way (flow mappings, anchors) is refused, not rewritten.

import { load, YAMLException } from 'js-yaml';
import { ConfigParseError } from './json';

export type YamlMap = Record<string, unknown>;

export function parseYaml(text: string): YamlMap {
  let root: unknown;
  try {
    root = load(text);
  } catch (e) {
    const msg = e instanceof YAMLException ? `line ${(e.mark?.line ?? 0) + 1}: ${e.reason}` : String(e);
    throw new ConfigParseError(`Invalid YAML at ${msg}`);
  }
  if (root === undefined || root === null) return {};
  if (typeof root !== 'object' || Array.isArray(root)) throw new ConfigParseError('Expected a YAML mapping at the top of the file.');
  return root as YamlMap;
}

// Plain scalars YAML would read as something other than a string.
const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~|[-+]?(?:\.?\d.*|\.inf|\.nan))$/i;
const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function yamlKey(key: string): string {
  return BARE_KEY.test(key) && !RESERVED.test(key) ? key : yamlString(key);
}

function yamlString(s: string): string {
  // JSON strings are valid YAML double-quoted scalars; also escape the non-printable chars JSON leaves raw.
  return JSON.stringify(s).replace(/[\u007f-\u009f﻿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function yamlValue(v: unknown): string {
  if (typeof v === 'string') return yamlString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(yamlValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${yamlKey(k)}: ${yamlValue(x)}`).join(', ')} }` : '{}';
  }
  throw new Error(`Unsupported YAML value: ${String(v)}`);
}

/** `name:` followed by its fields as a block mapping; object fields become nested block mappings. */
export function renderEntry(name: string, table: YamlMap, indent: number, step: number, eol = '\n'): string {
  const pad = (n: number) => ' '.repeat(n);
  const lines = [`${pad(indent)}${yamlKey(name)}:`];
  for (const [k, v] of Object.entries(table)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
      lines.push(`${pad(indent + step)}${yamlKey(k)}:`);
      for (const [sk, sv] of Object.entries(v)) lines.push(`${pad(indent + 2 * step)}${yamlKey(sk)}: ${yamlValue(sv)}`);
    } else {
      lines.push(`${pad(indent + step)}${yamlKey(k)}: ${yamlValue(v)}`);
    }
  }
  return lines.map((l) => l + eol).join('');
}

interface Line {
  raw: string;
  indent: number;
  /** Not blank and not a comment. */
  content: boolean;
}

function classify(raw: string): Line {
  const body = raw.replace(/\r?\n$/, '');
  const indent = body.length - body.trimStart().length;
  const trimmed = body.trim();
  return { raw, indent, content: trimmed.length > 0 && !trimmed.startsWith('#') };
}

/** The key of a `key: …` line and what follows the colon (comment stripped), or null if the line isn't one. */
export function parseKeyLine(raw: string): { key: string; rest: string } | null {
  const body = raw.replace(/\r?\n$/, '').trimStart();
  let m: RegExpExecArray | null;
  let key: string;
  if ((m = /^"((?:[^"\\]|\\.)*)"\s*:(?=\s|$)/.exec(body))) key = JSON.parse(`"${m[1]}"`);
  else if ((m = /^'((?:[^']|'')*)'\s*:(?=\s|$)/.exec(body))) key = m[1].replace(/''/g, "'");
  else if ((m = /^([^\s#'"{}[\],&*!|>%@`?:-](?:[^#:]|:(?!\s|$))*?)\s*:(?=\s|$)/.exec(body))) key = m[1];
  else return null;
  const rest = body.slice(m[0].length).replace(/(^|\s)#.*$/, '').trim();
  return { key, rest };
}

interface Block {
  /** Index of the `root:` line. */
  head: number;
  /** One past the last line belonging to the block (its last indented, non-blank line). */
  end: number;
  /** Indentation of the block's entries, if it has any. */
  childIndent?: number;
}

function findBlock(lines: Line[], root: string): Block | null {
  const head = lines.findIndex((l) => l.content && l.indent === 0 && parseKeyLine(l.raw)?.key === root);
  if (head < 0) return null;
  const rest = parseKeyLine(lines[head].raw)!.rest;
  if (rest && !/^(?:\{\s*\}|~|null)$/.test(rest)) {
    throw new ConfigParseError(`"${root}" is written inline in this file; edit it by hand or convert it to a block mapping.`);
  }
  let end = head + 1;
  let childIndent: number | undefined;
  for (let i = head + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.content && l.indent === 0) break;
    if (l.raw.trim().length && l.indent > 0) {
      end = i + 1;
      if (l.content && childIndent === undefined) childIndent = l.indent;
    }
  }
  return { head, end, childIndent };
}

/** Lines [start, end) of entry `name` inside the block, or null. */
function findEntry(lines: Line[], block: Block, name: string): [number, number] | null {
  if (block.childIndent === undefined) return null;
  const indent = block.childIndent;
  const start = lines.findIndex((l, i) => i > block.head && i < block.end && l.content && l.indent === indent && parseKeyLine(l.raw)?.key === name);
  if (start < 0) return null;
  let end = start + 1;
  for (let i = start + 1; i < block.end; i++) {
    const l = lines[i];
    if (l.content && l.indent <= indent) break;
    // Deeper lines (including comments) belong to the entry; comments at the entry's level belong to the next key.
    if (l.raw.trim().length && l.indent > indent) end = i + 1;
  }
  return [start, end];
}

function split(text: string): Line[] {
  return text.split(/(?<=\n)/).filter((s) => s.length).map(classify);
}

/** The indentation step the file already uses, or 2. */
function detectStep(lines: Line[]): number {
  const first = lines.find((l) => l.content && l.indent > 0);
  return first ? first.indent : 2;
}

/** Replaces (or adds) `root.name` with `table`, in place if the entry exists, otherwise at the end of the block. */
export function upsertEntry(text: string, root: string, name: string, table: YamlMap): string {
  parseYaml(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = split(text);
  const raws = lines.map((l) => l.raw);
  const block = findBlock(lines, root);
  const step = detectStep(lines);

  if (!block) {
    if (parseYaml(text)[root] !== undefined) {
      throw new ConfigParseError(`"${root}" is written inline in this file; edit it by hand or convert it to a block mapping.`);
    }
    let base = raws.join('');
    if (base.trim().length === 0) base = '';
    if (base.length && !base.endsWith('\n')) base += eol;
    const sep = base.length === 0 || base.endsWith(`${eol}${eol}`) ? '' : eol;
    return `${base}${sep}${yamlKey(root)}:${eol}${renderEntry(name, table, step, step, eol)}`;
  }

  const indent = block.childIndent ?? step;
  const rendered = renderEntry(name, table, indent, step, eol);
  const range = findEntry(lines, block, name);
  if (range) {
    raws.splice(range[0], range[1] - range[0], rendered);
  } else {
    // An inline empty value (`root: {}`) turns into a block header; its comment stays.
    const head = raws[block.head];
    const rest = parseKeyLine(head)!.rest;
    if (rest) raws[block.head] = head.replace(/:\s*(\{\s*\}|~|null)/, ':');
    if (!raws[block.end - 1].endsWith('\n')) raws[block.end - 1] += eol;
    raws.splice(block.end, 0, rendered);
  }
  return raws.join('');
}

/** Removes `root.name`; drops the `root:` line too once nothing is left under it. */
export function removeEntry(text: string, root: string, name: string): string {
  parseYaml(text);
  const lines = split(text);
  const block = findBlock(lines, root);
  const range = block && findEntry(lines, block, name);
  if (!block || !range) {
    const servers = parseYaml(text)[root];
    if (servers && typeof servers === 'object' && name in servers) {
      throw new ConfigParseError(`"${root}.${name}" is written inline in this file; edit it by hand or convert it to a block mapping.`);
    }
    return text;
  }
  // Comments right above the entry, at its indentation, are about it and go with it.
  while (range[0] - 1 > block.head && !lines[range[0] - 1].content && lines[range[0] - 1].raw.trim().length && lines[range[0] - 1].indent === block.childIndent) range[0]--;
  const raws = lines.map((l) => l.raw);
  raws.splice(range[0], range[1] - range[0]);
  // A blank line that separated the entry from the one before it goes with it.
  const blank = (s: string | undefined) => s !== undefined && !s.trim().length;
  if (range[0] > 0 && blank(raws[range[0] - 1]) && (range[0] === raws.length || blank(raws[range[0]]))) raws.splice(range[0] - 1, 1);
  const after = split(raws.join(''));
  const left = findBlock(after, root)!;
  const empty = after.slice(left.head + 1, left.end).every((l) => !l.raw.trim().length);
  const headComment = /\s#/.test(after[left.head].raw);
  if (empty && !headComment) {
    const out = after.map((l) => l.raw);
    out.splice(left.head, left.end - left.head);
    // Don't leave the blank separator line behind at the end of the file.
    while (left.head === out.length && out.length > 0 && !out[out.length - 1].trim().length) out.pop();
    return out.join('');
  }
  return raws.join('');
}
