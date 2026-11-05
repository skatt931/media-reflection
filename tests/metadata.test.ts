import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMetadata, fetchImage } from "../src/metadata.ts";

const lookup = async (host: string) => (host.endsWith("internal.test") ? ["10.0.0.5"] : ["93.184.216.34"]);
const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

test("YouTube uses the fixed oEmbed endpoint and returns bounded metadata", async () => {
  let requested = "";
  const transport: typeof fetch = async (url, init) => {
    requested = String(url);
    assert.equal(init?.redirect, "error");
    return Response.json({
      title: "Заголовок",
      author_name: "Автор",
      thumbnail_url: "https://i.ytimg.com/a.jpg",
    });
  };
  const value = await fetchMetadata("https://www.youtube.com/live/abcdefgh?is=1", transport, lookup);
  assert.equal(value?.title, "Заголовок");
  assert.equal(value?.creator, "Автор");
  assert.equal(value?.image, "https://i.ytimg.com/a.jpg");
  assert.equal(new URL(requested).hostname, "www.youtube.com");
  assert.ok(requested.includes("abcdefgh"));
});

test("Threads share link redirects to the post; post text comes from <title>", async () => {
  const pages: Record<string, () => Response> = {
    "https://www.threads.com/share/abc": () =>
      new Response(null, { status: 302, headers: { location: "/@x/post/1" } }),
    "https://www.threads.com/@x/post/1": () =>
      html(
        '<html><head><meta property="og:title" content="Name (&#064;x) on Threads" />' +
          '<meta property="og:image" content="https://cdn.test/a.jpg?a=1&amp;b=2" />' +
          '<meta property="og:url" content="https://www.threads.com/&#064;x/post/1" />' +
          '<meta property="og:site_name" content="Threads" />' +
          "<title>Перший рядок\n\nдругий рядок</title></head><body>",
      ),
  };
  const transport: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "manual");
    return pages[String(url)]?.() ?? new Response("", { status: 404 });
  };
  const value = await fetchMetadata("https://www.threads.com/share/abc", transport, lookup);
  assert.equal(value?.title, "Перший рядок");
  assert.equal(value?.creator, "Name (@x)");
  assert.equal(value?.description, "Перший рядок другий рядок");
  assert.equal(value?.image, "https://cdn.test/a.jpg?a=1&b=2");
  assert.equal(value?.url, "https://www.threads.com/@x/post/1");
});

test("private addresses are refused, including after a redirect", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "http://db.internal.test/" } });
  };
  assert.equal(await fetchMetadata("http://127.0.0.1/secret", transport, lookup), null);
  assert.equal(await fetchMetadata("http://[::1]/", transport, lookup), null);
  assert.equal(calls, 0);
  assert.equal(await fetchMetadata("https://public.test/", transport, lookup), null);
  assert.equal(calls, 1);
});

test("images must be a known image type under the size limit", async () => {
  const image = (type: string) => async () =>
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type } });
  assert.deepEqual((await fetchImage("https://cdn.test/a", image("image/jpeg"), lookup))?.ext, "jpg");
  assert.equal(await fetchImage("https://cdn.test/a", image("text/html"), lookup), null);
  const huge: typeof fetch = async () =>
    new Response("x", { headers: { "content-type": "image/png", "content-length": "9000000" } });
  assert.equal(await fetchImage("https://cdn.test/a", huge, lookup), null);
});

test("network failure degrades to null", async () => {
  const transport: typeof fetch = async () => {
    throw Error("offline");
  };
  assert.equal(await fetchMetadata("https://example.test/", transport, lookup), null);
  assert.equal(await fetchMetadata("https://www.youtube.com/watch?v=abc", transport, lookup), null);
});
