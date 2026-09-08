import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseRoot = join(root, "dist", "release");
const staging = join(releaseRoot, "computercraft-lua");
const archive = join(releaseRoot, "computercraft-lua.zip");

rmSync(staging, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(staging, { recursive: true });

for (const directory of ["gateway", "turtle"]) {
  cpSync(join(root, "computercraft", directory), join(staging, "computercraft", directory), {
    recursive: true,
  });
}
cpSync(join(root, "deploy", "minecraft", "README.md"), join(staging, "DEPLOYMENT.md"));

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [relative(staging, path).replaceAll("\\", "/")];
  });
}

const manifest = {
  package: "computercraft-lua",
  version: packageJson.version,
  protocolVersion: 1,
  files: filesUnder(staging).sort(),
  generatedBy: "npm run release:lua",
};
writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function commandAvailable(command) {
  try {
    execFileSync(process.platform === "win32" ? "where.exe" : "which", [command], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

if (commandAvailable("zip")) {
  execFileSync("zip", ["-qr", archive, "."], { cwd: staging, stdio: "inherit" });
} else if (process.platform === "win32" && commandAvailable("tar")) {
  execFileSync("tar", ["-a", "-cf", archive, "-C", staging, "."], { stdio: "inherit" });
} else {
  throw new Error("A zip executable is required to create computercraft-lua.zip");
}

console.log(`Created ${archive}`);
