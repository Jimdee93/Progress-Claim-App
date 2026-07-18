// Runs inside Electron's main process. Spawns the Prisma CLI (migrate +
// seed) and the Next.js production server as child processes, using
// Electron's own bundled Node binary (via ELECTRON_RUN_AS_NODE) rather than
// assuming a system Node install exists on the user's machine.

const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

function runNode(projectRoot, scriptPath, args, env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} ${args.join(" ")} exited with code ${result.status}`);
  }
}

// Applies pending migrations and (idempotently) seeds/updates the single
// admin user from ADMIN_EMAIL / ADMIN_PASSWORD. Safe to run on every launch.
function migrateAndSeed(projectRoot, env) {
  const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  runNode(projectRoot, prismaCli, ["migrate", "deploy"], env);

  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const seedScript = path.join(projectRoot, "prisma", "seed.ts");
  runNode(projectRoot, tsxCli, [seedScript], env);
}

// Starts `next start` bound to loopback only (never expose this to the LAN)
// and returns the child process so the caller can kill it on quit.
function startNextServer(projectRoot, port, env) {
  const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: projectRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  return child;
}

module.exports = { migrateAndSeed, startNextServer };
