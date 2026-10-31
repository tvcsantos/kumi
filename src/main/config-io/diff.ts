import type { DiffLine } from '@shared/types';

/** Line diff with `context` lines around each change; unchanged stretches collapse to a `skip` line. */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

  // Config edits are local, so trimming the common prefix/suffix keeps the LCS table small even for big files.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const all: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'context', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      all.push({ kind: 'context', text: midA[i] });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      all.push({ kind: 'add', text: midB[j++] });
    } else {
      all.push({ kind: 'del', text: midA[i++] });
    }
  }
  all.push(...a.slice(endA).map((text): DiffLine => ({ kind: 'context', text })));

  const keep = all.map(() => false);
  all.forEach((line, idx) => {
    if (line.kind === 'context') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(all.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  all.forEach((line, idx) => {
    if (keep[idx]) {
      if (skipped) out.push({ kind: 'skip', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
      skipped = 0;
      out.push(line);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ kind: 'skip', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  return out;
}
