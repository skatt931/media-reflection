// Pulls a backup of the server's database and covers to this Mac over SSH (Tailscale).
// Usage: node scripts/backup.mjs [pull] [--force] | install | uninstall | status
// Config (.env): BACKUP_HOST (required), BACKUP_DIR, BACKUP_REMOTE_DIR, BACKUP_KEEP.
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const label = "com.media-reflection.backup";
const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const domain = `gui/${process.getuid()}`;
const intervalMs = 7 * 24 * 60 * 60 * 1000;
const stamp = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/;

const host = process.env.BACKUP_HOST ?? "";
const remoteDir = process.env.BACKUP_REMOTE_DIR || "media-reflection";
const keep = Number(process.env.BACKUP_KEEP) || 12;
const backupDir = resolve(
  (process.env.BACKUP_DIR || "~/Backups/media-reflection").replace(/^~(?=\/|$)/, homedir()),
);
const logFile = join(backupDir, "backup.log");

const args = process.argv.slice(2);
const force = args.includes("--force");
const command = args.find((arg) => !arg.startsWith("--")) ?? "pull";
const launchctl = (...args) => execFileSync("launchctl", args, { stdio: "pipe" }).toString();
const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const snapshots = () =>
  existsSync(backupDir)
    ? readdirSync(backupDir)
        .filter((name) => stamp.test(name))
        .sort()
    : [];
const age = (name) => Date.now() - Date.parse(name.replace(/T(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3"));
const days = (ms) => `${(ms / 86_400_000).toFixed(1)} дн.`;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (existsSync(backupDir)) appendFileSync(logFile, `${line}\n`);
}

function pull() {
  if (!/^[\w.@-]+$/.test(host) || host.startsWith("-")) {
    throw new Error("Задай BACKUP_HOST у .env: ім'я Tailscale або user@host сервера.");
  }
  if (!/^[\w./-]+$/.test(remoteDir) || remoteDir.includes(".."))
    throw new Error("Некоректний BACKUP_REMOTE_DIR.");

  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const latest = snapshots().at(-1);
  if (!force && latest && age(latest) < intervalMs) {
    return log(
      `Пропущено: останній backup ${latest} має ${days(age(latest))}, а інтервал 7 дн. (--force щоб ігнорувати).`,
    );
  }

  const name = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const staging = join(backupDir, `.partial-${name}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { mode: 0o700 });
  try {
    const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host];
    const data = `~/${remoteDir}/data`;
    const scratch = "~/.media-reflection-backup";

    // 1. Consistent copies of the databases on the server (the bot keeps running).
    // The journal database exists only after the first import, so a missing one is not an error.
    const snapshot = (file, flags = "") => {
      const result = spawnSync(
        "ssh",
        [
          ...ssh,
          `mkdir -p -m 700 ${scratch} && node --input-type=module - ${flags}${data}/${file} ${scratch}/${file}`,
        ],
        {
          input: readFileSync(join(root, "scripts", "db-snapshot.mjs")),
          stdio: ["pipe", "inherit", "inherit"],
        },
      );
      if (result.status !== 0) throw new Error(`Не вдалося зробити знімок ${file} на сервері.`);
    };
    snapshot("media.sqlite");
    snapshot("journal.sqlite", "--skip-missing ");

    // 2. Stream the snapshot and covers, then remove the server-side copy.
    execFileSync(
      "/bin/bash",
      [
        "-c",
        `set -o pipefail; ssh "\${@:2}" "j=; test -f ${scratch}/journal.sqlite && j=journal.sqlite; tar -cf - -C ${scratch} media.sqlite \\$j -C ${data} covers; rc=\\$?; rm -rf ${scratch}; exit \\$rc" | tar -xf - -C "$1"`,
        "_",
        staging,
        ...ssh,
      ],
      { stdio: "inherit" },
    );

    // 3. Prove the copy restores: open it and check integrity before it replaces anything.
    const db = new DatabaseSync(join(staging, "media.sqlite"), { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const items = db.prepare("SELECT count(*) AS n FROM items").get().n;
    db.close();
    if (integrity !== "ok") throw new Error(`Перевірка цілісності не пройдена: ${integrity}`);
    const covers = readdirSync(join(staging, "covers")).length;

    let journal = "щоденника немає";
    if (existsSync(join(staging, "journal.sqlite"))) {
      const jdb = new DatabaseSync(join(staging, "journal.sqlite"), { readOnly: true });
      const jIntegrity = jdb.prepare("PRAGMA integrity_check").get().integrity_check;
      const entries = jdb.prepare("SELECT count(*) AS n FROM journal_entries").get().n;
      jdb.close();
      if (jIntegrity !== "ok") throw new Error(`Перевірка цілісності щоденника не пройдена: ${jIntegrity}`);
      journal = `записів щоденника ${entries}, integrity ok`;
    }

    renameSync(staging, join(backupDir, name));
    log(
      `Backup ${name}: записів ${items}, обкладинок ${covers}, user_version ${version}, integrity ok; ${journal}.`,
    );
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  for (const old of snapshots().slice(0, -keep)) {
    rmSync(join(backupDir, old), { recursive: true, force: true });
    log(`Видалено старий backup ${old}.`);
  }
}

if (command === "pull") {
  try {
    pull();
  } catch (error) {
    log(`ПОМИЛКА: ${error.message}`);
    process.exit(1);
  }
} else if (command === "install") {
  if (process.platform !== "darwin") {
    console.error("Лише для macOS.");
    process.exit(1);
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  const program = [
    process.execPath,
    "--env-file-if-exists=.env",
    join(root, "scripts", "backup.mjs"),
    "pull",
  ];
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${program.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict></plist>
`,
  );
  try {
    launchctl("bootout", domain, plist);
  } catch {}
  launchctl("bootstrap", domain, plist);
  console.log(`Встановлено: перевірка щодня о 12:00 і при вході, backup — коли минуло 7 дн. Лог: ${logFile}`);
} else if (command === "uninstall") {
  try {
    launchctl("bootout", domain, plist);
  } catch {}
  if (existsSync(plist)) unlinkSync(plist);
  console.log("Розклад видалено. Існуючі backup не чіпав.");
} else if (command === "status") {
  const all = snapshots();
  const latest = all.at(-1);
  console.log(
    latest
      ? `Копій: ${all.length}, остання ${latest} (${days(age(latest))} тому). ${backupDir}`
      : `Копій немає. ${backupDir}`,
  );
  try {
    launchctl("print", `${domain}/${label}`);
    console.log("Розклад: встановлено.");
  } catch {
    console.log("Розклад: не встановлено (npm run backup:install).");
  }
} else {
  console.error("Використання: [pull] [--force] | install | uninstall | status");
  process.exit(1);
}
