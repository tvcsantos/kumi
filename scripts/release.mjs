// Bumps the version, commits and creates the annotated tag that release.yml builds from, with the
// Kumi-Update trailers that make a release important or required. Doesn't push.
//
//   npm run release -- patch
//   npm run release:important -- minor "Fixes installs failing for Zed"
//   npm run release:required -- patch "Fixes a token leak in OAuth refresh" --platforms windows
//
// The bump is anything `npm version` takes: patch, minor, major, prerelease --preid rc, or 0.4.0-rc.1.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { levelError, normalizePlatforms, trailerLines } from './release-levels.mjs';

const root = join(import.meta.dirname, '..');

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    important: { type: 'boolean' },
    required: { type: 'boolean' },
    platforms: { type: 'string' },
    preid: { type: 'string' },
  },
});

const [bump, reason = '', ...extra] = positionals;
if (!bump || extra.length) {
  fail('usage: release <patch|minor|major|prerelease|x.y.z> ["reason"] [--important|--required] [--platforms mac,windows,linux] [--preid rc]');
}
if (values.important && values.required) {
  fail('pick one of --important and --required');
}
const trailers = {
  level: values.required ? 'required' : values.important ? 'important' : undefined,
  reason: reason || undefined,
  platforms: normalizePlatforms(values.platforms),
};
// The same rules release.yml checks, so a bad marker fails here rather than in CI.
const error = levelError(trailers);
if (error) {
  fail(error);
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) {
  fail('the working tree has changes; commit or stash them first');
}

// npm only bumps package.json and package-lock.json; the commit and tag are made below, because
// `npm version -m` takes a single message and the trailers need their own lines.
const npmArgs = ['version', bump, '--no-git-tag-version', ...(values.preid ? ['--preid', values.preid] : [])];
// npm is a .cmd on Windows, which needs a shell; these arguments have no spaces.
execFileSync('npm', npmArgs, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

const lines = trailerLines(trailers);
const message = [version, ...(lines.length ? ['', ...lines] : [])].join('\n');

git('add', 'package.json', 'package-lock.json');
git('commit', '-m', message);
git('tag', '-a', tag, '-m', message);

console.log(`Tagged ${tag}${trailers.level ? ` as ${trailers.level}` : ''}.`);
if (lines.length) {
  console.log(lines.map((t) => `  ${t}`).join('\n'));
}
console.log('Push it to start the release:\n  git push --follow-tags');
