// Mac side of the weekly copy into Obsidian: asks the server to export new diary entries and ideas, then copies
// the files into the vault with `rsync --ignore-existing` — a note already in the vault is never overwritten.
// Usage: node scripts/journal-pull.mjs [--dry-run]
// Config (.env): BACKUP_HOST, BACKUP_REMOTE_DIR (as for backup), OBSIDIAN_VAULT_PATH or JOURNAL_VAULT_DIR,
// optionally IDEAS_VAULT_DIR (default: Ideas/Inbox inside the diary folder).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const host = process.env.BACKUP_HOST ?? "";
const remoteDir = process.env.BACKUP_REMOTE_DIR || "media-reflection";
const vault = process.env.OBSIDIAN_VAULT_PATH ?? "";
const dest = resolve(
  (process.env.JOURNAL_VAULT_DIR || (vault && join(vault, "Journal"))).replace(/^~(?=\/|$)/, homedir()),
);
// Ideas get their own folder inside the diary one unless told otherwise; it is created on the first copy.
const ideasDest = resolve(
  (process.env.IDEAS_VAULT_DIR || join(dest, "Ideas", "Inbox")).replace(/^~(?=\/|$)/, homedir()),
);
const dryRun = process.argv.includes("--dry-run");
const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

try {
  if (!/^[\w.@-]+$/.test(host) || host.startsWith("-"))
    throw new Error("Задай BACKUP_HOST у .env: ім'я Tailscale або user@host сервера.");
  if (!/^[\w./-]+$/.test(remoteDir) || remoteDir.includes(".."))
    throw new Error("Некоректний BACKUP_REMOTE_DIR.");
  if (!process.env.JOURNAL_VAULT_DIR && !vault)
    throw new Error("Задай OBSIDIAN_VAULT_PATH або JOURNAL_VAULT_DIR.");
  if (!existsSync(dest)) throw new Error(`Папки щоденника у vault немає: ${dest}`);

  // 1. The server writes files for entries it has not exported yet and lists every entry file with its checksum.
  const output = execFileSync(
    "ssh",
    [...ssh, host, `cd ~/${remoteDir} && npm run -s journal:export -- --json${dryRun ? " --dry-run" : ""}`],
    { stdio: ["ignore", "pipe", "inherit"] },
  ).toString();
  const report = JSON.parse(output.trim().split("\n").at(-1));
  if (!/^\/[\w./-]+$/.test(report.dir))
    throw new Error(`Неочікувана папка експорту на сервері: ${report.dir}`);

  // 2. Copy only what the vault does not have. Top-level .md only: `.deleted/` stays on the server.
  const failures = [];
  const copy = (label, remote, folder) => {
    const missing = remote.files.filter((f) => !existsSync(join(folder, f.name)));
    const differ = remote.files.filter(
      (f) => existsSync(join(folder, f.name)) && sha256(join(folder, f.name)) !== f.sha256,
    );
    if (missing.length && !dryRun) {
      mkdirSync(folder, { recursive: true });
      execFileSync(
        "rsync",
        [
          "-rt",
          "--ignore-existing",
          "--include=*.md",
          "--exclude=*",
          "-e",
          `ssh ${ssh.join(" ")}`,
          `${host}:${remote.dir}/`,
          `${folder}/`,
        ],
        { stdio: "inherit" },
      );
    }

    // 3. Every copied file must match the entry in the database.
    const failed = dryRun
      ? []
      : missing.filter((f) => !existsSync(join(folder, f.name)) || sha256(join(folder, f.name)) !== f.sha256);
    console.log(
      `${label}: ${dryRun ? "буде скопійовано" : "скопійовано"} ${missing.length - failed.length}, уже були ${remote.files.length - missing.length}. ${folder}`,
    );
    for (const f of missing) if (!failed.includes(f)) console.log(`  ${f.name}`);
    for (const f of differ) console.log(`Відрізняється у vault, не перезаписано: ${f.name}`);
    for (const name of remote.retired) console.log(`Видалено в боті (у vault не чіпаю): ${name}`);
    for (const f of failed) console.log(`ПОМИЛКА: ${f.name} не скопійовано або текст не збігається.`);
    failures.push(...failed);
  };
  copy("Щоденник", report, dest);
  if (report.ideas) {
    if (!/^\/[\w./-]+$/.test(report.ideas.dir))
      throw new Error(`Неочікувана папка ідей на сервері: ${report.ideas.dir}`);
    copy("Ідеї", report.ideas, ideasDest);
  } else console.log("Ідеї: сервер ще без цієї версії, пропускаю.");
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(`ПОМИЛКА: ${error.message}`);
  process.exitCode = 1;
}
