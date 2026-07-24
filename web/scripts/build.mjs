import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const outputRoot = resolve(webRoot, "..", "resources", "extensions");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const common = {
  bundle: true,
  charset: "utf8",
  format: "iife",
  legalComments: "none",
  minify: true,
  sourcemap: false,
  target: "es2022",
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [resolve(webRoot, "src", "runtime", "bootstrap.ts")],
  loader: { ".png": "dataurl" },
  outfile: resolve(outputRoot, "runtime.js"),
});

for (const id of ["plugin-manager", "themes", "reviews", "timestamp-notes", "last-played", "begone-mouse", "quick-seek", "stream-switcher", "easy-sound-output", "qol-things", "no-spoilers"]) {
  const source = resolve(webRoot, "src", "extensions", id);
  const output = resolve(outputRoot, id);
  await mkdir(output, { recursive: true });
  await build({
    ...common,
    entryPoints: [resolve(source, "index.ts")],
    loader: { ".css": "text" },
    outfile: resolve(output, "index.js"),
  });
  await cp(resolve(source, "manifest.json"), resolve(output, "manifest.json"));
  await cp(resolve(source, "styles.css"), resolve(output, "styles.css"));
}
