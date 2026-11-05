import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync, readFileSync, writeFileSync, lstatSync, chmodSync } from "node:fs";

if (!process.stdin.isTTY) {
  console.error("Запусти npm run setup:groq у власному інтерактивному терміналі.");
  process.exit(1);
}
if (existsSync(".env") && lstatSync(".env").isSymbolicLink()) {
  console.error(".env не має бути symlink.");
  process.exit(1);
}
console.log(
  "Ключ створюється на https://console.groq.com/keys (Free tier достатньо). Його буде записано в .env.",
);
const quiet = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const hidden = createInterface({ input: process.stdin, output: quiet, terminal: true });
process.stdout.write("Groq API key (приховано): ");
const key = (await hidden.question("")).trim();
hidden.close();
console.log();
if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) {
  console.error("Некоректний формат ключа.");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const model = (await rl.question("Model ID [openai/gpt-oss-120b]: ")).trim() || "openai/gpt-oss-120b";
rl.close();
if (!/^[a-zA-Z0-9_./-]+$/.test(model)) {
  console.error("Некоректний Model ID.");
  process.exit(1);
}
try {
  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error();
  const models = await response.json();
  if (!models.data?.some((m) => m.id === model)) {
    console.error("Модель недоступна для цього ключа. .env не змінено.");
    process.exit(1);
  }
  let env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  for (const [name, value] of Object.entries({ GROQ_API_KEY: key, GROQ_MODEL: model })) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "gm");
    env = pattern.test(env) ? env.replace(pattern, line) : env.replace(/\s*$/, "") + "\n" + line + "\n";
  }
  writeFileSync(".env", env, { mode: 0o600 });
  chmodSync(".env", 0o600);
  console.log(`Збережено. Модель: ${model}. Перезапусти npm start.`);
} catch {
  console.error("Не вдалося перевірити ключ (мережа або невірний ключ). .env не змінено.");
  process.exitCode = 1;
}
