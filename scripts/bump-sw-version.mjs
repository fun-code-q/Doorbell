#!/usr/bin/env node
// Bumps the service-worker CACHE_VERSION to a hash of the current public/ tree.
// This is critical: without it, a developer who ships a JS fix but forgets to
// touch sw.js will have users stuck on the old cached bundle forever.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = join(root, "public");
const swFile = join(publicDir, "sw.js");

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        // Avoid hashing the SW itself (we'd hash → write → re-hash forever).
        if (name === "sw.js" || name.startsWith(".")) continue;
        const p = join(dir, name);
        const s = statSync(p);
        if (s.isDirectory()) out.push(...walk(p));
        else out.push(p);
    }
    return out;
}

const hasher = createHash("sha256");
for (const p of walk(publicDir).sort()) {
    const rel = relative(publicDir, p).replace(/\\/g, "/");
    hasher.update(rel + "\0");
    hasher.update(readFileSync(p));
    hasher.update("\0");
}
const version = "v" + hasher.digest("hex").slice(0, 12);

const sw = readFileSync(swFile, "utf8");
const replaced = sw.replace(/const\s+CACHE_VERSION\s*=\s*["'][^"']*["'];/, `const CACHE_VERSION = "${version}";`);
if (replaced === sw) {
    console.warn("warning: did not find CACHE_VERSION declaration in sw.js");
    process.exit(0);
}
writeFileSync(swFile, replaced);
console.log(`sw.js CACHE_VERSION → ${version}`);
