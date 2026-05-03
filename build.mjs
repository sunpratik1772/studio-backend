import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const root = path.dirname(fileURLToPath(import.meta.url));

const distDir = path.resolve(root, "dist");
await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(root, "src/index.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  sourcemap: "linked",
  // Map the inlined-lib import paths to local files so the source can stay
  // unchanged from the original monorepo layout.
  alias: {
    "@workspace/db": path.resolve(root, "src/lib/db/index.ts"),
    "@workspace/api-zod": path.resolve(root, "src/schemas/index.ts"),
  },
  external: [
    "*.node",
    "pg-native",
    "@google/*",
    "fsevents",
  ],
  plugins: [
    esbuildPluginPino({ transports: ["pino-pretty"] }),
  ],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);
`,
  },
});
