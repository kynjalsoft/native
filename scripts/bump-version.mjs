#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(root, 'VERSION');
const pkgFile = path.join(root, 'package.json');
const lockFile = path.join(root, 'package-lock.json');
const androidStringsFile = path.join(root, 'android/app/src/main/res/values/strings.xml');

const git = (...args) =>
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const gitInherit = (...args) =>
  execFileSync('git', args, { cwd: root, stdio: 'inherit' });

// Pre-flight: the release is created with the GitHub CLI as the last step.
// Check it is installed and logged in BEFORE anything is committed, tagged or
// pushed - otherwise a missing login leaves a pushed tag with no release (and
// no release workflow run), which is exactly what a re-run cannot repair.
try {
  execFileSync('gh', ['auth', 'status'], { cwd: root, stdio: 'ignore' });
} catch {
  console.error('GitHub CLI is not available or not logged in.');
  console.error('Run `gh auth login` (or set GH_TOKEN), then re-run `npm run bump`.');
  process.exit(1);
}

const dirty = git('status', '--porcelain');
if (dirty) {
  console.error('Working tree is not clean. Commit or stash changes before bumping.');
  console.error(dirty);
  process.exit(1);
}

const current = fs.readFileSync(versionFile, 'utf8').trim();
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`Invalid version in VERSION: "${current}" (expected MAJOR.MINOR.PATCH)`);
  process.exit(1);
}
parts[2] += 1;
const next = parts.join('.');
const androidStrings = fs.readFileSync(androidStringsFile, 'utf8');
const previousRuntime = `<string name="expo_runtime_version">${current}</string>`;
if (!androidStrings.includes(previousRuntime)) {
  console.error('Android native runtime does not match VERSION; refusing to release.');
  process.exit(1);
}

const existingTags = new Set(git('tag', '--list').split(/\r?\n/).filter(Boolean));
if (existingTags.has(next)) {
  console.error(`Tag ${next} already exists.`);
  process.exit(1);
}

fs.writeFileSync(versionFile, `${next}\n`);
fs.writeFileSync(androidStringsFile, androidStrings.replace(previousRuntime, `<string name="expo_runtime_version">${next}</string>`));

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = next;
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`${current} -> ${next}`);

gitInherit('add', 'VERSION', 'package.json', 'package-lock.json', 'android/app/src/main/res/values/strings.xml');
gitInherit('commit', '-m', `chore: update version number to ${next}`);
gitInherit('tag', '-a', next, '-m', next);
gitInherit('push', '--follow-tags');

try {
  execFileSync(
    'gh',
    ['release', 'create', next, '--title', next, '--generate-notes'],
    { cwd: root, stdio: 'inherit' },
  );
} catch {
  console.error(`The tag ${next} is pushed but the GitHub release could not be created.`);
  console.error(`Fix the GitHub CLI login and run: gh release create ${next} --title ${next} --generate-notes`);
  process.exit(1);
}

console.log(`Released ${next}`);
