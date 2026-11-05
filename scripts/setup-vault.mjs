import { createInterface } from "node:readline/promises";
import { readFileSync, existsSync, lstatSync, writeFileSync, chmodSync } from "node:fs";
import { isAbsolute, join } from "node:path";
if (!process.stdin.isTTY) {
  console.error("Запусти npm run setup:vault в інтерактивному терміналі.");
  process.exit(1);
}
if (existsSync(".env") && lstatSync(".env").isSymbolicLink()) {
  console.error(".env не має бути symlink.");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const path = (await rl.question("Абсолютний шлях до Obsidian vault: ")).trim();
rl.close();
if (!isAbsolute(path) || /[\r\n"\\]/.test(path) || !existsSync(join(path, ".obsidian"))) {
  console.error("Потрібна існуюча папка vault із .obsidian.");
  process.exit(1);
}
let env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const line = `OBSIDIAN_VAULT_PATH="${path}"`;
env = /^OBSIDIAN_VAULT_PATH=.*$/m.test(env)
  ? env.replace(/^OBSIDIAN_VAULT_PATH=.*$/gm, line)
  : env.replace(/\s*$/, "") + "\n" + line + "\n";
writeFileSync(".env", env, { mode: 0o600 });
chmodSync(".env", 0o600);
console.log("Шлях збережено. Перезапусти бота.");
