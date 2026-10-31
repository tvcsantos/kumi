// Format-preserving JSON / JSONC editing: comments, key order and unrelated content survive.

import { applyEdits, modify, parse, printParseErrorCode, type FormattingOptions, type JSONPath, type ParseError } from 'jsonc-parser';

export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigParseError';
  }
}

export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indented = text.split(/\r?\n/).find((line) => /^[ \t]+\S/.test(line));
  if (indented?.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol };
  const spaces = indented ? indented.length - indented.trimStart().length : 2;
  return { insertSpaces: true, tabSize: Math.min(Math.max(spaces, 1), 8), eol };
}

/** Parses JSON or JSONC; an empty file is an empty object. Throws on syntax errors so we never edit a broken file. */
export function parseJson(text: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const e = errors[0];
    const line = text.slice(0, e.offset).split('\n').length;
    throw new ConfigParseError(`Invalid JSON at line ${line}: ${printParseErrorCode(e.error)}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigParseError('Config root must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function getAt(root: unknown, path: JSONPath): unknown {
  let cur = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/** Sets (or, with `undefined`, removes) the value at `path`, creating parents as needed. */
export function setAt(text: string, path: JSONPath, value: unknown): string {
  const formattingOptions = detectFormatting(text);
  const base = text.trim() === '' ? '{}' : text;
  const edited = applyEdits(base, modify(base, path, value, { formattingOptions }));
  // Keep a trailing newline for files we create.
  return text.trim() === '' && !edited.endsWith('\n') ? edited + formattingOptions.eol : edited;
}

export function removeAt(text: string, path: JSONPath): string {
  if (getAt(parseJson(text), path) === undefined) return text;
  return setAt(text, path, undefined);
}
