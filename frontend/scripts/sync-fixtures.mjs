// Dev only: copy contracts/fixtures into public/fixtures for fixture mode.
// (A symlink here broke Vercel's build-output copy, and production never serves fixtures.)
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "contracts", "fixtures");
const dst = join(here, "..", "public", "fixtures");
if (existsSync(src)) cpSync(src, dst, { recursive: true });
