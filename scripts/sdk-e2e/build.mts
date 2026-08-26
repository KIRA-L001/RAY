import { createRequire } from "node:module";
import { build } from "esbuild";

// Bundles the SDK into a browser iife exposing window.RAY.createRay.
await build({
  entryPoints: ["packages/sdk/src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "RAY",
  outfile: "scripts/sdk-e2e/ray.js",
  logLevel: "info",
});
