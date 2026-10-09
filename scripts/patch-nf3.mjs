// Fix for Vercel builds: nf3 (used by nitro to trace server dependencies)
// imports a named export from a minified CommonJS copy of @vercel/nft that
// Node cannot read as ESM. Switch it to a default import. Safe to run many
// times; does nothing when the file is missing or already patched.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = "node_modules/nf3/dist/_chunks/trace.mjs";
if (existsSync(file)) {
  const src = readFileSync(file, "utf8");
  const bad = 'import { nodeFileTrace } from "@vercel/nft";';
  if (src.includes(bad)) {
    writeFileSync(file, src.replace(bad, 'import __nft from "@vercel/nft";\nconst { nodeFileTrace } = __nft;'));
    console.log("patched nf3 for @vercel/nft");
  }
}
