// Runs the bot as a macOS launchd agent: starts at login, restarts after a crash.
// Usage: node scripts/service.mjs install [--caffeinate] | uninstall | status
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const label = "com.media-reflection.bot";
const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const domain = `gui/${process.getuid()}`;
const root = resolve(import.meta.dirname, "..");
const [command, flag] = process.argv.slice(2);
const launchctl = (...args) => execFileSync("launchctl", args, { stdio: "pipe" }).toString();
const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

if (process.platform !== "darwin") {
  console.error("Лише для macOS.");
  process.exit(1);
}
if (command === "install") {
  const program = [process.execPath, "--env-file-if-exists=.env", "src/main.ts"];
  if (flag === "--caffeinate") program.unshift("/usr/bin/caffeinate", "-i");
  mkdirSync(join(root, "data"), { recursive: true, mode: 0o700 });
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${program.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(join(root, "data", "bot.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(root, "data", "bot.log"))}</string>
</dict></plist>
`,
  );
  try {
    launchctl("bootout", domain, plist);
  } catch {}
  launchctl("bootstrap", domain, plist);
  console.log(`Запущено. Лог: data/bot.log. Node: ${process.execPath}`);
} else if (command === "uninstall") {
  try {
    launchctl("bootout", domain, plist);
  } catch {}
  if (existsSync(plist)) unlinkSync(plist);
  console.log("Сервіс зупинено й видалено.");
} else if (command === "status") {
  try {
    const info = launchctl("print", `${domain}/${label}`);
    console.log(info.match(/^\s*state = .*/m)?.[0].trim() ?? "встановлено");
  } catch {
    console.log("Не встановлено.");
  }
} else {
  console.error("Використання: install [--caffeinate] | uninstall | status");
  process.exit(1);
}
