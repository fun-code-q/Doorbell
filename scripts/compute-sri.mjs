#!/usr/bin/env node
// Compute Subresource Integrity (SRI) hashes for every external script
// referenced in public/index.html. Replaces the `integrity="sha384-PLACEHOLDER_*"`
// values in place. Run after pinning a new version of supabase-js or libsodium.
//
// Usage:
//   node scripts/compute-sri.mjs

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = resolve(__dirname, "..", "public", "index.html");

const html = readFileSync(indexHtmlPath, "utf8");

// Naively pull every <script src="https..." integrity="sha384-PLACEHOLDER_*"> entry.
const scriptRe = /<script\s+([^>]*?)src="(https:\/\/[^"]+)"([^>]*?)integrity="sha384-PLACEHOLDER_[A-Z_]+"([^>]*?)><\/script>/g;

const matches = [...html.matchAll(scriptRe)];
if (matches.length === 0) {
    console.log("Nothing to update — no PLACEHOLDER SRI integrity attributes found.");
    process.exit(0);
}

let updated = html;
for (const m of matches) {
    const url = m[2];
    process.stdout.write(`Fetching ${url} ... `);
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`failed: ${res.status} ${res.statusText}`);
        process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha384 = "sha384-" + createHash("sha384").update(buf).digest("base64");
    console.log(`${sha384.slice(0, 24)}…`);
    // Replace the first remaining PLACEHOLDER block tied to this URL.
    const swap = new RegExp(
        `(<script\\s+[^>]*?src="${url.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"[^>]*?integrity=")sha384-PLACEHOLDER_[A-Z_]+(")`,
    );
    if (!swap.test(updated)) {
        console.warn(`  warning: no placeholder found for ${url}, skipping`);
        continue;
    }
    updated = updated.replace(swap, `$1${sha384}$2`);
}

writeFileSync(indexHtmlPath, updated, "utf8");
console.log("public/index.html updated with fresh SRI hashes.");
