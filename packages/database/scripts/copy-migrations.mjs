import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "migrations");
const destination = resolve(packageRoot, "dist", "migrations");

if (!existsSync(source)) {
  throw new Error(`Migration directory does not exist: ${source}`);
}

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
