import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Run after: MAHID_PORTABLE_BUILD=1 npm run build (PowerShell syntax in README).
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'win32', 'This package includes the Windows Node runtime.');
assert.equal(process.arch, 'x64', 'This package targets Windows x64.');
const name = `MAHID-Portable-Windows-x64-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const output = join(root, 'releases', name);
await mkdir(output, { recursive: true });
const excluded = new Set(['node_modules', '.next', '.next-portable', '.tmp', 'dist',
  '.diagnostics', '.dev-runtime', '.ampblogs-state', '.local-sheets', '.git']);
const filter = path => !path.slice(root.length).split(/[\\/]/).some(part =>
  excluded.has(part) || part.startsWith('.env') || part.endsWith('.tsbuildinfo'));

await cp(join(root, 'web/.next-portable/standalone'), join(output, 'dashboard'), {
  recursive: true, dereference: true,
  filter: path => !path.split(/[\\/]/).some(part => part.startsWith('.env')),
});
await cp(join(root, 'web/.next-portable/static'), join(output, 'dashboard/web/.next-portable/static'), { recursive: true });
try {
  await cp(join(root, 'web/public'), join(output, 'dashboard/web/public'), { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await cp(join(root, 'extension/dist'), join(output, 'extension'), { recursive: true });
for (const entry of ['web', 'extension', 'shared', 'playwright-worker', 'scripts', 'test', 'tests',
  'package.json', 'package-lock.json', 'README.md', '.gitignore']) {
  await cp(join(root, entry), join(output, 'source', entry), { recursive: true, filter });
}
await mkdir(join(output, 'runtime'));
await cp(process.execPath, join(output, 'runtime/node.exe'));
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
assert.equal(license.ok, true, 'Unable to obtain the bundled Node.js license.');
await writeFile(join(output, 'runtime/NODE-LICENSE.txt'), await license.text());

// Standalone tracing copies executable files, but may omit package license notices.
async function licenses(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    const original = join(root, path.slice(join(output, 'dashboard').length + 1));
    try {
      for (const file of await readdir(original)) {
        if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(file)) {
          await cp(join(original, file), join(path, file), { recursive: true });
        }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await licenses(path);
  }
}
await licenses(join(output, 'dashboard/node_modules'));
await writeFile(join(output, 'Start Dashboard.cmd'), [
  '@echo off', 'cd /d "%~dp0"', 'set "HOSTNAME=127.0.0.1"', 'set "PORT=3000"',
  'set "NODE_ENV=production"', 'echo Open http://localhost:3000 in Chrome.',
  'echo Keep this window open while using MAHID. Press Ctrl+C to stop.',
  '"%~dp0runtime\\node.exe" "%~dp0dashboard\\web\\server.js"', 'pause', '',
].join('\r\n'));
await writeFile(join(output, 'READ ME FIRST.txt'), `MAHID portable build - Windows x64

1. Copy the ZIP to the other computer and EXTRACT ALL files to a local folder.
2. Double-click Start Dashboard.cmd. Keep its console open.
3. Open http://localhost:3000 in Chrome. Port 3000 must be free.
4. Go to chrome://extensions and turn on Developer mode.
5. Click Load unpacked and select this package's extension folder.
6. Pin Backlink Autofill 2.0. Create/save a business profile in the dashboard,
   set it active, then use Refresh from dashboard in the extension popup.

Node.js ${process.version} is bundled. No npm install or build is needed to run.
This runtime targets Windows x64; macOS/Linux need their own Node runtime/build.
Profiles stay in this computer's Chrome localStorage. Existing profiles, browser
cookies, login sessions, extension history, secrets and Google credentials are
not transferred. Keep using the same Chrome profile and localhost:3000 address.
Close the console to stop the dashboard. An existing program on port 3000 must
be stopped before launching this copy.

The source folder contains the complete application source and package lock.
For development, install Node.js 20.9+ (Node 24 recommended), open a terminal in
source, run npm ci, then npm run dev:web. Optional Playwright worker/test tools
need their own browser install: npx playwright install chromium.
The ready-to-run dashboard and extension do not require that worker.
Research evidence, temporary files, caches and old browser profiles are omitted.
Google Sheets credentials/integrations require separate configuration; this
package does not enable Sheets writes or copy this computer's credentials.
`);
const manifest = JSON.parse(await readFile(join(output, 'extension/manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
const required = [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(entry => entry.js), 'popup/popup.css', 'popup/popup.js'];
for (const file of required) await readFile(join(output, 'extension', file));
await readFile(join(output, 'dashboard/web/server.js'));
await writeFile(join(output, 'BUILD.json'), JSON.stringify({
  builtAt: new Date().toISOString(), node: process.version, platform: process.platform,
  arch: process.arch, extensionVersion: manifest.version,
}, null, 2));
const archive = `${output}.zip`;
const quote = value => `'${value.replaceAll("'", "''")}'`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
  `Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`],
{ stdio: 'inherit' });
assert.equal(result.status, 0, 'ZIP creation failed.');
console.log(JSON.stringify({ output, archive }));
