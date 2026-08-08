// Builds the static client export (./out) for the Capacitor APK.
//
// Next `output: 'export'` can't emit server route handlers or dynamic [param]
// pages without generateStaticParams. We temporarily move those out of the app
// tree (server APIs + online-only dynamic pages), run the export, then restore
// them. The cashier core + the query-param /receipt page stay and work offline.

import { rename, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const STASH = path.join(ROOT, ".cap-stash");

// Paths excluded from the static export (online-only / not statically renderable).
const EXCLUDE = [
  "src/app/api", // all server route handlers — backend stays on App Hosting
  // reservation detail is a static query-param page (/reservations/details?id=)
  // so it ships in the export and works inside the app.
  "src/middleware.ts", // CORS middleware — App Hosting only; output:export forbids middleware
];

const key = (rel) => rel.replace(/[\\/]/g, "__");

async function stash() {
  await mkdir(STASH, { recursive: true });
  for (const rel of EXCLUDE) {
    const from = path.join(ROOT, rel);
    if (!existsSync(from)) continue;
    await rename(from, path.join(STASH, key(rel)));
    console.log(`[build:cap] stashed ${rel}`);
  }
}

async function restore() {
  for (const rel of EXCLUDE) {
    const from = path.join(STASH, key(rel));
    if (!existsSync(from)) continue;
    const to = path.join(ROOT, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    console.log(`[build:cap] restored ${rel}`);
  }
  await rm(STASH, { recursive: true, force: true });
}

let status = 0;
await stash();
try {
  // Clear prior build/type artifacts so stale generated route types (e.g. from a
  // dev run) don't reference the stashed pages during type-check.
  await rm(path.join(ROOT, ".next"), { recursive: true, force: true });
  const env = {
    ...process.env,
    BUILD_TARGET: "capacitor",
    NEXT_DISABLE_TURBOPACK: "1",
    NEXT_PRIVATE_MAX_WORKERS: "1",
    // Online-only features reach the deployed backend from the bundled app.
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || "https://app.shareat.net",
  };
  const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env, shell: true });
  status = r.status ?? 1;
} finally {
  await restore();
}
process.exit(status);
