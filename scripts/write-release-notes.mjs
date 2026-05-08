import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildInfoPath = path.join(root, 'src', 'build-info.json');
const buildInfo = fs.existsSync(buildInfoPath)
  ? JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'))
  : {};

function sh(cmd) {
  return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

const version = pkg.version;
const tag = `v${version}`;
const date = new Date().toISOString().slice(0, 10);
const vsixName = `mcp-writing-vscode-${version}.vsix`;
const outDir = path.join(root, 'release');
const outPath = path.join(outDir, `${tag}.md`);

let changes = '';
try {
  changes = sh('git log --pretty=format:"- %s (%h)" -n 20');
} catch {
  changes = '- Add release notes';
}

const body = `# ${tag} - ${date}\n\n## Artifact\n\n- \`${vsixName}\`\n\n## Build Identity\n\n- Extension version: \`${version}\`\n- Git SHA: \`${buildInfo.git_sha ?? 'unknown'}\`\n- Git branch: \`${buildInfo.git_branch ?? 'unknown'}\`\n- Build time (UTC): \`${buildInfo.build_time_utc ?? 'unknown'}\`\n- Repo dirty at build: \`${String(buildInfo.repo_dirty ?? 'unknown')}\`\n\n## What's Changed\n\n${changes}\n\n## Install\n\n1. Download \`${vsixName}\` from this release.\n2. In VS Code, run \`Extensions: Install from VSIX...\`.\n3. Select the downloaded file.\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, body, 'utf8');
console.log(`Wrote ${path.relative(root, outPath)}`);
