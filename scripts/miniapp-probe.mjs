// Issue #4: checks that a Mini App served by `tailscale serve` opens in Telegram.
// Usage (from the Mac, with .env):
//   npm run miniapp:probe -- send  <https-url>   inline button in the owner's chat
//   npm run miniapp:probe -- menu  <https-url>   menu button in the owner's chat only
//   npm run miniapp:probe -- reset               menu button back to the commands list
// Config (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID. MINIAPP_URL can replace <https-url>.

const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const owner = Number(process.env.TELEGRAM_USER_ID);
const [command, arg] = process.argv.slice(2);
const url = arg ?? process.env.MINIAPP_URL ?? "";

async function api(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method}: ${result.error_code} ${result.description ?? ""}`);
  return result.result;
}

function requireUrl() {
  if (!/^https:\/\/[^\s/]+/.test(url))
    throw new Error("Потрібна HTTPS-адреса, наприклад https://<host>.ts.net/");
}

try {
  if (!token || !Number.isSafeInteger(owner))
    throw new Error("Потрібні TELEGRAM_BOT_TOKEN і TELEGRAM_USER_ID у .env.");
  if (command === "send") {
    requireUrl();
    await api("sendMessage", {
      chat_id: owner,
      text: "Перевірка Mini App через Tailscale (issue #4).",
      disable_notification: true,
      reply_markup: { inline_keyboard: [[{ text: "Відкрити Mini App", web_app: { url } }]] },
    });
    console.log("Кнопку надіслано в чат з ботом.");
  } else if (command === "menu") {
    requireUrl();
    await api("setChatMenuButton", {
      chat_id: owner,
      menu_button: { type: "web_app", text: "Mini App", web_app: { url } },
    });
    console.log("Кнопка меню веде в Mini App. Список команд повертає: npm run miniapp:probe -- reset");
  } else if (command === "reset") {
    await api("setChatMenuButton", { chat_id: owner, menu_button: { type: "commands" } });
    console.log("Кнопка меню знову показує команди.");
  } else {
    throw new Error("Команда: send <url> | menu <url> | reset");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
