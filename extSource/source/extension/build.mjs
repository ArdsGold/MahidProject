import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const readOnlyTrace = process.argv.includes('--read-only-trace');
const hash = createHash('sha256');
async function hashSources(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await hashSources(path);
    else { hash.update(path.slice(root.length)); hash.update(await readFile(path)); }
  }
}
await hashSources(join(root, 'src'));
hash.update(await readFile(join(root, 'manifest.json')));
hash.update(await readFile(fileURLToPath(import.meta.url)));
const buildId = `${hash.digest('hex').slice(0, 16)}${readOnlyTrace ? '-read-only' : ''}`;

await rm(dist, { recursive: true, force: true });

await esbuild.build({
  entryPoints: [
    { in: join(root, "src/background.ts"), out: 'background' },
    { in: join(root, readOnlyTrace ? "src/content/publication-reader.ts" : "src/content/content.ts"), out: 'content/content' },
    join(root, "src/content/dashboard-assets.ts"),
    join(root, "src/content/directory3-receiver.ts"),
    join(root, "src/content/publication-reader.ts"),
    join(root, "src/popup/popup.ts"),
  ],
  define: { __BA2_BUILD__: JSON.stringify(buildId), __BA2_READ_ONLY_TRACE__: JSON.stringify(readOnlyTrace), __BA2_SHEETS_WRITE_ENABLED__: 'false', __BA2_LEGACY_AUTOMATION_TEST__: 'false' },
  bundle: true,
  outdir: dist,
  outbase: join(root, "src"),
  entryNames: "[dir]/[name]",
  format: "iife",
  target: "chrome110",
  sourcemap: false,
  logLevel: "info",
});

await mkdir(join(dist, "popup"), { recursive: true });
await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
await cp(join(root, "src/popup/popup.html"), join(dist, "popup/popup.html"));
await cp(join(root, "src/popup/popup.css"), join(dist, "popup/popup.css"));

console.log("extension: build complete ->", dist);
console.log('extension build:', buildId, readOnlyTrace ? '(read-only; automation disabled)' : '');
