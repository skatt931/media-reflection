import { Store } from "../src/store.ts";
import { exportVault } from "../src/vault.ts";
process.umask(0o077);
const s = new Store(process.env.DB_PATH ?? "./data/media.sqlite");
try {
  const r = exportVault(s, process.env.OBSIDIAN_VAULT_PATH ?? "");
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : "Експорт не завершено.");
  process.exitCode = 1;
} finally {
  s.close();
}
