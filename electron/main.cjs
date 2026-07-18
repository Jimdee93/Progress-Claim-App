const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const { migrateAndSeed, startNextServer } = require("./server.cjs");

const START_PORT = 3100;
const MAX_PORT_ATTEMPTS = 10;

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

function getProjectRoot() {
  // Dev: __dirname = <repo>/electron, project root is one level up.
  // Packaged: the whole project is copied under resources/app (electron-
  // builder's default unpacked-app location when asar is disabled).
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
}

// The distributable never ships real login credentials. On first launch we
// generate a random admin login local to this machine, persist it in
// userData (never in the installed app itself), and show it once. Every
// later launch reuses the same saved credentials.
function ensureDesktopCredentials(userDataDir) {
  const configPath = path.join(userDataDir, "desktop-config.json");
  if (fs.existsSync(configPath)) {
    return { ...JSON.parse(fs.readFileSync(configPath, "utf8")), isFirstRun: false, configPath };
  }
  const config = {
    AUTH_SECRET: crypto.randomBytes(32).toString("base64"),
    ADMIN_EMAIL: "admin@local",
    ADMIN_PASSWORD: crypto.randomBytes(9).toString("base64url"),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { ...config, isFirstRun: true, configPath };
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server at ${url} did not respond within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

// next start exits immediately (non-zero) if the port is taken, instead of
// picking another one — retry with the next port when that happens.
async function startServerWithRetry(projectRoot, env) {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = START_PORT + i;
    const child = startNextServer(projectRoot, port, env);

    const exited = new Promise((resolve) => {
      child.once("exit", (code) => resolve({ exitedEarly: true, code }));
    });
    const ready = waitForServer(`http://127.0.0.1:${port}/login`, 20000).then(() => ({
      exitedEarly: false,
    }));

    const result = await Promise.race([exited, ready]);
    if (!result.exitedEarly) {
      return { child, port };
    }
    // Port likely in use — try the next one.
  }
  throw new Error("Could not find a free port to start the app server.");
}

async function bootstrap() {
  const projectRoot = getProjectRoot();

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "advantage.db");

  const creds = ensureDesktopCredentials(userDataDir);

  const env = {
    ...process.env,
    // Always an absolute path — Next's production bundle resolves a
    // relative "file:./x" sqlite URL differently than dev mode does.
    DATABASE_URL: `file:${dbPath}`,
    NODE_ENV: "production",
    AUTH_SECRET: creds.AUTH_SECRET,
    ADMIN_EMAIL: creds.ADMIN_EMAIL,
    ADMIN_PASSWORD: creds.ADMIN_PASSWORD,
  };

  migrateAndSeed(projectRoot, env);
  const { child, port } = await startServerWithRetry(projectRoot, env);
  serverProcess = child;
  serverPort = port;

  if (creds.isFirstRun) {
    dialog.showMessageBoxSync({
      type: "info",
      title: "Advantage — first-time setup",
      message: "Your local login has been created.",
      detail:
        `Email: ${creds.ADMIN_EMAIL}\n` +
        `Password: ${creds.ADMIN_PASSWORD}\n\n` +
        `This is saved on this computer only, at:\n${creds.configPath}\n\n` +
        `You'll need it every time you open the app — write it down now.`,
    });
  }

  createWindow(port);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    dialog.showErrorBox("Advantage failed to start", String((err && err.stack) || err));
    app.quit();
  });
});

app.on("window-all-closed", () => {
  killServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", killServer);

app.on("activate", () => {
  if (mainWindow === null && serverProcess && serverPort) {
    createWindow(serverPort);
  }
});
