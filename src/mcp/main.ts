import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { JournalStore } from "../journal.ts";
import { Store } from "../store.ts";
import { handleLine } from "./server.ts";
import type { Sources } from "./tools.ts";

// The MCP server for Claude Code and Codex: they start it over SSH on the server and talk to it through
// stdin/stdout. Run node directly, not `npm run`, whose banner would break the protocol on stdout.
// The library is opened read-only; the journal read-write, for add_idea only.

// stdout carries the protocol and nothing else: any stray log line goes to stderr.
console.log = console.error;
console.info = console.error;

function open<T>(what: string, path: string, make: (path: string) => T): T | undefined {
  // A missing file is not created: an empty database would hide a wrong path.
  if (!existsSync(path)) {
    console.error(`MCP: ${what} не знайдено (${path}), її інструменти недоступні.`);
    return undefined;
  }
  try {
    return make(path);
  } catch (e) {
    console.error(`MCP: ${what} не відкрито: ${(e as Error).message}`);
    return undefined;
  }
}

const sources: Sources = {
  store: open(
    "медіатеку",
    process.env.DB_PATH ?? "./data/media.sqlite",
    (p) => new Store(p, { readOnly: true }),
  ),
  journal: open(
    "БД щоденника",
    process.env.JOURNAL_DB_PATH ?? "./data/journal.sqlite",
    (p) => new JournalStore(p),
  ),
};

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const reply = handleLine(line, sources);
  if (reply) process.stdout.write(reply + "\n");
});
input.on("close", () => {
  sources.store?.db.close();
  sources.journal?.db.close();
});
