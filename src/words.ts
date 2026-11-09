// Word matching shared by the bot's search and the Mini App (which also runs it in the browser mock):
// no Node imports here.

// Ukrainian words change their endings («Відьмак», «Відьмака»; «штучний», «штучного»), so a
// word matches by its beginning: words of 5–6 letters lose two final letters, longer ones three.
export const fold = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[_’ʼ`]/g, (c) => (c === "_" ? " " : "'"))
    .replace(/ё/g, "е");

export const stem = (word: string) =>
  word.length < 5 ? word : word.slice(0, Math.max(4, word.length - (word.length >= 7 ? 3 : 2)));

const wordsOf = (term: string) =>
  fold(term)
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);

// `text` must already be folded.
export const matches = (text: string, term: string) => {
  const parts = wordsOf(term);
  return parts.length > 0 && parts.every((w) => text.includes(stem(w)));
};

// The stems a search for `term` looks for, for highlighting the hits.
export const stems = (term: string) => wordsOf(term).map(stem);
