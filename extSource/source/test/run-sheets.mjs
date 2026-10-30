import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Like extension tests, resolve bundler-style TS imports before Node executes
// the existing mocked backend tests. This never loads real Sheets credentials.
const output = new URL('../extension/test/.tmp/sheets-suite/writeback.test.mjs', import.meta.url);
await mkdir(new URL('./', output), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('./sheets-writeback.test.mjs', import.meta.url))], outfile: fileURLToPath(output),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });
const result = spawnSync(process.execPath, ['--test', fileURLToPath(output)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
