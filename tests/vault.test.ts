import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.ts";
import { exportVault, personalMarker } from "../src/vault.ts";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vault-test-"));
  mkdirSync(join(root, ".obsidian"));
  return {
    root,
    s: new Store(":memory:"),
    clean() {
      this.s.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("incremental export preserves personal section and stable path as title changes", () => {
  const f = fixture();
  try {
    const id = f.s.capture(1, "https://example.com/page");
    f.s.edit(id, { title: "Читабельна назва" });
    const first = exportVault(f.s, f.root);
    assert.equal(first.created, 1);
    const dir = join(f.root, "Медіатека", "Матеріали");
    const name = readdirSync(dir)[0];
    const path = join(dir, name);
    assert.match(name, /Читабельна назва/);
    let text = readFileSync(path, "utf8");
    assert.match(text, /Мої враження/);
    assert.equal(exportVault(f.s, f.root).unchanged, 1);
    writeFileSync(path, text + "Моя ручна нотатка\n");
    f.s.edit(id, { title: "Інша назва" });
    assert.equal(exportVault(f.s, f.root).updated, 1);
    text = readFileSync(path, "utf8");
    assert.match(text, /Інша назва/);
    assert.match(text, /Моя ручна нотатка/);
    assert.deepEqual(readdirSync(dir), [name]);
    assert.ok(text.includes(personalMarker));
  } finally {
    f.clean();
  }
});
test("manual generated edits conflict without overwrite; missing files are recreated", () => {
  const f = fixture();
  try {
    f.s.capture(1, "Тест");
    exportVault(f.s, f.root);
    const dir = join(f.root, "Медіатека", "Матеріали");
    const path = join(dir, readdirSync(dir)[0]);
    const modified = readFileSync(path, "utf8").replace("# Тест", "# Ручна зміна");
    writeFileSync(path, modified);
    assert.equal(exportVault(f.s, f.root).conflicts.length, 1);
    assert.equal(readFileSync(path, "utf8"), modified);
    rmSync(path);
    assert.equal(exportVault(f.s, f.root).created, 1);
  } finally {
    f.clean();
  }
});
test("export refuses symlink escape and does not checkpoint failed item writes", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "vault-outside-"));
  try {
    f.s.capture(1, "Тест");
    mkdirSync(join(f.root, "Медіатека"));
    symlinkSync(outside, join(f.root, "Медіатека", "Матеріали"));
    assert.throws(() => exportVault(f.s, f.root), /symlink|символіч/i);
    assert.equal(f.s.all("SELECT * FROM vault_exports").length, 0);
    assert.equal(readdirSync(outside).length, 0);
  } finally {
    f.clean();
    rmSync(outside, { recursive: true, force: true });
  }
});
test("interrupted manifest write recovers on retry without mistaking its own file for a conflict", () => {
  const f = fixture();
  try {
    f.s.capture(1, "Матеріал");
    const original = f.s.run.bind(f.s);
    let failed = false;
    f.s.run = (sql: string, ...args: any[]) => {
      if (!failed && sql.includes("INSERT OR REPLACE INTO vault_exports")) {
        failed = true;
        throw Error("simulated checkpoint failure");
      }
      return original(sql, ...args);
    };
    assert.throws(() => exportVault(f.s, f.root), /checkpoint/);
    f.s.run = original;
    const result = exportVault(f.s, f.root);
    assert.equal(result.conflicts.length, 0);
    assert.equal(f.s.all("SELECT * FROM vault_exports WHERE substr(item_id,1,2)<>'__'").length, 1);
    assert.equal(readdirSync(join(f.root, "Медіатека", "Матеріали")).length, 1);
  } finally {
    f.clean();
  }
});
