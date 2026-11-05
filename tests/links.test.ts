import { test } from "node:test";
import assert from "node:assert/strict";
import { findUrl, normalizeUrl, typeFromUrl } from "../src/links.ts";

test("tracking parameters are removed so repeated shares dedupe", () => {
  assert.equal(
    normalizeUrl("https://open.spotify.com/track/0ZYd?si=bYDE5&utm_source=native-share-menu"),
    "https://open.spotify.com/track/0ZYd",
  );
  assert.equal(
    normalizeUrl("https://youtu.be/Yg2t5w8vj5Q?is=kvE4V"),
    "https://www.youtube.com/watch?v=Yg2t5w8vj5Q",
  );
  assert.equal(
    normalizeUrl("https://www.instagram.com/p/DfUc02eCLaF/?img_index=3&cplk=MTB2"),
    "https://www.instagram.com/p/DfUc02eCLaF/",
  );
  assert.equal(
    normalizeUrl("https://threads.net/@a/post/1?xmt=AQG&slof=1"),
    "https://www.threads.com/@a/post/1",
  );
  assert.equal(normalizeUrl("https://example.com/watch?v=1&page=2"), "https://example.com/watch?v=1&page=2");
  assert.equal(normalizeUrl("https://% погане"), null);
});

test("known domains get a type without AI", () => {
  assert.equal(typeFromUrl("https://www.threads.com/share/BAQ"), "social_post");
  assert.equal(typeFromUrl("https://open.spotify.com/episode/7h"), "podcast");
  assert.equal(typeFromUrl("https://open.spotify.com/album/1"), "music_album");
  assert.equal(typeFromUrl("https://www.youtube.com/live/6vm"), "video");
  assert.equal(typeFromUrl("https://store.steampowered.com/app/1"), "game");
  assert.equal(typeFromUrl("https://example.com"), "unknown");
});

test("trailing punctuation is not part of a shared URL", () => {
  assert.equal(findUrl("дивись (https://example.com/a)."), "https://example.com/a");
});
