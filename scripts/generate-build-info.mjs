import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const pkgPath = path.join(root, 'package.json');
const outPath = path.join(root, 'src', 'build-info.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

function sh(cmd) {
  return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

let gitSha = 'unknown';
let gitBranch = 'unknown';
let repoDirty = 'unknown';
try {
  gitSha = sh('git rev-parse --short=12 HEAD');
  gitBranch = sh('git rev-parse --abbrev-ref HEAD');
  repoDirty = sh('git status --porcelain').length > 0;
} catch {}

const buildInfo = {
  extension_version: pkg.version,
  git_sha: gitSha,
  git_branch: gitBranch,
  build_time_utc: new Date().toISOString(),
  repo_dirty: repoDirty,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath}`);
