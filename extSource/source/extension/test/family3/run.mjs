import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
let failures = 0;
for (const name of ['junk-removal-category', 'limousine-category', 'plumbing-category', 'captcha-isolation', 'automation-policy', 'unique-listing', 'directory3', 'groovy-directory', 'bizz-directory', 'reddit-directory', 'familydir', 'search-domain-here', 'fire-directory', 'linkedin-directory', 'related-directory', 'relevant-directory', 'relevant-directories', 'efdir', 'ifidir', 'smartdir', 'toptendir', 'advanced-seo-directory', 'expansion-directory', 'bluebook-directory', 'aurora-directory', 'fruity-directory', 'greeny-directory', 'f03-directory', 'jet-links', 'adbrite-directory', 'jet-terms', 'directory3-submission', 'directory3-popup', 'directory3-popup-retest']) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
  const output = new URL(`../.tmp/family3/${name}.test.mjs`, import.meta.url);
  await mkdir(new URL('./', output), { recursive: true });
  await build({ entryPoints: [fileURLToPath(new URL(`./${name}.test.ts`, import.meta.url))], bundle: true, outfile: fileURLToPath(output), format: 'esm', platform: 'node', target: 'node20', external: ['happy-dom'], logLevel: 'warning' });
  // Separate processes release each large captured DOM/category dictionary.
  // They also prevent test globals from leaking between Family 1 and Family 3.
  const result = spawnSync(process.execPath, [fileURLToPath(output)], { stdio: 'inherit' });
  if (result.status !== 0) { failures++; console.error('FAIL Family 3 suite:', name); }
}

if (failures) process.exitCode = 1;

