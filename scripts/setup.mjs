import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) {
  console.error(".env вже існує. Для повторного налаштування спочатку перейменуй його.");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Запусти npm run setup у власному інтерактивному терміналі.");
  process.exit(1);
}
console.log(
  "1. Відкрий https://t.me/BotFather у Telegram.\n2. Надішли /newbot, обери назву та username із закінченням bot.\n3. Скопіюй токен.",
);
const quiet = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output: quiet, terminal: true });
process.stdout.write("Токен бота (введення приховане): ");
const token = (await rl.question("")).trim();
rl.close();
console.log();
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error("Неправильний формат токена.");
  process.exit(1);
}
async function api(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method}: ${result.error_code}`);
  return result.result;
}
try {
  const me = await api("getMe");
  const hook = await api("getWebhookInfo");
  if (hook.url) throw new Error("Цей бот уже має webhook. Створи окремого бота для PoC.");
  const code = randomBytes(8).toString("hex");
  console.log(`Відкрий https://t.me/${me.username} і надішли йому:\n/start ${code}\nОчікую до 3 хвилин…`);
  const deadline = Date.now() + 180000;
  let offset = 0;
  let owner;
  while (Date.now() < deadline && !owner) {
    const updates = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (m?.chat?.type === "private" && m.text === `/start ${code}` && m.from.id === m.chat.id)
        owner = m.from.id;
    }
  }
  if (!owner) throw new Error("Час очікування минув. Запусти налаштування знову.");
  writeFileSync(
    ".env",
    `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_USER_ID=${owner}\nDB_PATH=./data/media.sqlite\n`,
    { mode: 0o600, flag: "wx" },
  );
  await api("sendMessage", { chat_id: owner, text: "Готово. Запусти npm start і надішли посилання." });
  console.log("Готово. Запусти npm start.");
} catch {
  console.error("Налаштування не завершено. Перевір токен, мережу і чи надіслано код боту.");
  process.exitCode = 1;
}
