import { describe, expect, it } from 'vitest';
import { lineDiff } from '../src/main/config-io/diff';
import { ConfigParseError, detectFormatting, parseJson, removeAt, setAt } from '../src/main/config-io/json';
import { parseHeader, parseToml, removeSections, renderSection, upsertSection } from '../src/main/config-io/toml';
import { parseKeyLine, parseYaml, removeEntry, upsertEntry, yamlKey } from '../src/main/config-io/yaml';

describe('json', () => {
  it('creates a file from nothing', () => {
    expect(setAt('', ['mcpServers', 'a'], { command: 'x' })).toBe('{\n  "mcpServers": {\n    "a": {\n      "command": "x"\n    }\n  }\n}\n');
  });

  it('keeps comments and detects tab indentation', () => {
    const text = '{\n\t// keep me\n\t"servers": {}\n}\n';
    expect(detectFormatting(text)).toMatchObject({ insertSpaces: false });
    const out = setAt(text, ['servers', 'a'], { command: 'x' });
    expect(out).toContain('// keep me');
    expect(out).toContain('\t\t"a": {');
  });

  it('refuses malformed files', () => {
    expect(() => parseJson('{ "a": ')).toThrow(ConfigParseError);
    expect(() => parseJson('[]')).toThrow(ConfigParseError);
  });

  it('removing a missing key is a no-op', () => {
    const text = '{ "a": 1 }';
    expect(removeAt(text, ['b', 'c'])).toBe(text);
  });
});

describe('toml', () => {
  it('parses headers with quoted keys', () => {
    expect(parseHeader('[mcp_servers."my server".env] # x')).toEqual({ keys: ['mcp_servers', 'my server', 'env'], array: false });
    expect(parseHeader('[[arr]]')).toEqual({ keys: ['arr'], array: true });
    expect(parseHeader('key = "[x]"')).toBeNull();
  });

  it('renders sub-tables for object fields', () => {
    expect(renderSection(['mcp_servers', 'a'], { command: 'npx', args: ['-y', 'p'], env: { K: 'v"q' } })).toBe(
      '[mcp_servers.a]\ncommand = "npx"\nargs = ["-y", "p"]\n\n[mcp_servers.a.env]\nK = "v\\"q"\n',
    );
  });

  it('removes a section family but keeps comments of the next section', () => {
    const text = 'x = 1\n\n[s.a]\nk = 1\n\n[s.a.env]\nT = "t"\n\n# about b\n[s.b]\nk = 2\n';
    expect(removeSections(text, ['s', 'a'])).toBe('x = 1\n\n# about b\n[s.b]\nk = 2\n');
  });

  it('upserts at the end and round-trips', () => {
    const out = upsertSection('x = 1\n', ['s', 'a'], { k: 'v' });
    expect(out).toBe('x = 1\n\n[s.a]\nk = "v"\n');
    expect(parseToml(out)).toEqual({ x: 1, s: { a: { k: 'v' } } });
    expect(upsertSection(out, ['s', 'a'], { k: 'w' })).toBe('x = 1\n\n[s.a]\nk = "w"\n');
  });

  it('refuses inline definitions it cannot remove safely', () => {
    expect(() => removeSections('s = { a = { k = 1 } }\n', ['s', 'a'])).toThrow(ConfigParseError);
  });
});

describe('yaml', () => {
  it('creates the block from nothing and round-trips', () => {
    const out = upsertEntry('', 's', 'a', { k: 'v', list: ['x', 1], m: { T: 't' } });
    expect(out).toBe('s:\n  a:\n    k: "v"\n    list: ["x", 1]\n    m:\n      T: "t"\n');
    expect(parseYaml(out)).toEqual({ s: { a: { k: 'v', list: ['x', 1], m: { T: 't' } } } });
    expect(removeEntry(out, 's', 'a')).toBe('');
  });

  it('follows the indentation the file uses', () => {
    const text = 'top:\n    deep: 1\ns:\n    b:\n        k: 1\n';
    expect(upsertEntry(text, 's', 'a', { k: 'v' })).toBe(`${text}    a:\n        k: "v"\n`);
  });

  it('turns an inline empty mapping into a block and keeps its comment', () => {
    expect(upsertEntry('s: {}  # servers\nx: 1\n', 's', 'a', { k: 1 })).toBe('s:  # servers\n  a:\n    k: 1\nx: 1\n');
    expect(upsertEntry('s:\nx: 1\n', 's', 'a', { k: 1 })).toBe('s:\n  a:\n    k: 1\nx: 1\n');
  });

  it('finds quoted keys and quotes keys YAML would misread', () => {
    const text = 's:\n  "a b":\n    k: 1\n';
    expect(removeEntry(text, 's', 'a b')).toBe('');
    expect(yamlKey('true')).toBe('"true"');
    expect(yamlKey('123')).toBe('"123"');
    expect(yamlKey('with space')).toBe('"with space"');
    expect(yamlKey('context7')).toBe('context7');
    expect(parseKeyLine("  'it''s': x # c")).toEqual({ key: "it's", rest: 'x' });
  });

  it('refuses inline definitions it cannot edit safely', () => {
    expect(() => upsertEntry('s: { b: { k: 1 } }\n', 's', 'a', { k: 1 })).toThrow(ConfigParseError);
    expect(() => upsertEntry('{ s: {} }\n', 's', 'a', { k: 1 })).toThrow(ConfigParseError);
    expect(() => removeEntry('s:\n  a: { k: 1 }\n', 's', 'b')).not.toThrow();
  });

  it('refuses malformed files', () => {
    expect(() => parseYaml('a: [1\n')).toThrow(ConfigParseError);
    expect(() => parseYaml('- a\n')).toThrow(ConfigParseError);
    expect(() => parseYaml('a: 1\na: 2\n')).toThrow(ConfigParseError);
  });
});

describe('lineDiff', () => {
  it('shows additions with context and collapses the rest', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line 10\nnew');
    const diff = lineDiff(before, after, 1);
    expect(diff).toEqual([
      { kind: 'skip', text: '… 10 unchanged lines' },
      { kind: 'context', text: 'line 10' },
      { kind: 'add', text: 'new' },
      { kind: 'context', text: 'line 11' },
      { kind: 'skip', text: '… 8 unchanged lines' },
    ]);
  });

  it('handles a new file', () => {
    expect(lineDiff('', 'a\nb\n')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });
});
