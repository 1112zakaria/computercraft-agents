import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requestedVersion = process.argv[2] ?? `v${packageJson.version}`;
if (
  !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion)
) {
  throw new Error("release version must be an immutable tag such as v0.2.0");
}

const releaseRoot = join(root, "dist", "release");
const staging = join(releaseRoot, "computercraft-lua");
const archive = join(releaseRoot, "computercraft-lua.zip");
const repository = "1112zakaria/computercraft-agents";

rmSync(staging, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(staging, { recursive: true });

for (const directory of ["gateway", "turtle"]) {
  cpSync(join(root, "computercraft", directory), join(staging, "computercraft", directory), {
    recursive: true,
  });
}
cpSync(join(root, "deploy", "minecraft", "README.md"), join(staging, "DEPLOYMENT.md"));
cpSync(join(root, "deploy", "minecraft", "enable-gather.lua"), join(staging, "enable-gather.lua"));
cpSync(
  join(root, "deploy", "minecraft", "install-direct.lua"),
  join(staging, "install-direct.lua"),
);
cpSync(
  join(root, "deploy", "minecraft", "install-gateway.lua"),
  join(staging, "install-gateway.lua"),
);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [relative(staging, path).replaceAll("\\", "/")];
  });
}

const stableBootstrapFiles = new Set([
  "computercraft/gateway/startup",
  "computercraft/gateway/startup.lua",
  "computercraft/gateway/update_bootstrap.lua",
  "computercraft/gateway/update_manager.lua",
  "computercraft/turtle/startup",
  "computercraft/turtle/startup.lua",
  "computercraft/turtle/compat.lua",
  "computercraft/turtle/update_bootstrap.lua",
  "computercraft/turtle/update_manager.lua",
]);
const persistentRuntimeFiles = new Set([
  "gateway.conf",
  "worker.conf",
  "gateway-outbox.json",
  "worker-state.json",
  "worker-command-cache.json",
  "worker-poll-cursor.json",
  "worker-event-outbox.json",
  "worker-update-journal.json",
  "worker-clock.txt",
]);
const deploymentUtilityFiles = new Set([
  "enable-gather.lua",
  "install-direct.lua",
  "install-gateway.lua",
]);
const runtimeFiles = filesUnder(staging)
  .filter((path) => path.endsWith(".lua"))
  .filter((path) => !deploymentUtilityFiles.has(path))
  .filter((path) => !persistentRuntimeFiles.has(path.split("/").pop()))
  .filter((path) => !stableBootstrapFiles.has(path))
  .sort();

const manifest = {
  package: "computercraft-lua",
  version: requestedVersion,
  protocolVersion: 1,
  runtimeVersions: {
    gateway: requestedVersion,
    turtle: requestedVersion,
  },
  runtimeFiles: runtimeFiles.map((path) => ({
    path,
    downloadUrl: `https://raw.githubusercontent.com/${repository}/${requestedVersion}/${path}`,
  })),
  files: filesUnder(staging).sort(),
  archiveUrl: `https://github.com/${repository}/releases/download/${requestedVersion}/computercraft-lua.zip`,
  manifestUrl: `https://github.com/${repository}/releases/download/${requestedVersion}/release-manifest.json`,
  stableBootstrapFiles: [...stableBootstrapFiles].sort(),
  deploymentUtilityFiles: [...deploymentUtilityFiles].sort(),
  excludedPersistentFiles: [...persistentRuntimeFiles].sort(),
  generatedBy: "npm run release:lua",
};
writeFileSync(
  join(staging, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

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
