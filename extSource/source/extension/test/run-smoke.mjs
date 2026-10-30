import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
// Own only this suite's artifacts; other diagnostics/private-ACL fixtures share .tmp.
const outDir = join(root, ".tmp", "engine-suite");
const outFile = join(outDir, "engine-smoke.mjs");
const backgroundOutFile = join(outDir, "background-smoke.mjs");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "engine-smoke.ts")],
  define: { __BA2_LEGACY_AUTOMATION_TEST__: "true" },
  bundle: true,
  outfile: outFile,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["happy-dom"],
  logLevel: "info",
});

await import(pathToFileURL(outFile).href);
await esbuild.build({
  entryPoints: [join(root, "background-smoke.ts")],
  // Only this fully intercepted legacy write-contract fixture permits writes.
  define: { __BA2_SHEETS_WRITE_ENABLED__: 'true', __BA2_LEGACY_AUTOMATION_TEST__: 'true' },
  bundle: true,
  outfile: backgroundOutFile,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["happy-dom"],
  logLevel: "info",
});
await import(pathToFileURL(backgroundOutFile).href);
await import("./popup-artifact.mjs");
await import("./dashboard-assets-smoke.mjs");
await import("./publication-reader-smoke.mjs");
await import("./content-profile-receiver-smoke.mjs");
await import("./manual-policy-smoke.mjs");
await import("./family3/run.mjs");
