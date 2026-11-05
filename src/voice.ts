// Telegram voice note → text via Groq Whisper. Returns null on any failure.
export type Transcribe = (fileId: string) => Promise<string | null>;

export function createTranscriber(
  groqKey: string | undefined,
  telegramToken: string | undefined,
  language: string | undefined = "uk",
  transport: typeof fetch = fetch,
): Transcribe | undefined {
  if (!groqKey || !telegramToken) return undefined;
  return async (fileId) => {
    try {
      const info = (await (
        await transport(`https://api.telegram.org/bot${telegramToken}/getFile`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
          signal: AbortSignal.timeout(15000),
        })
      ).json()) as any;
      const path = info?.result?.file_path;
      if (!info?.ok || typeof path !== "string") return null;
      const audio = await transport(`https://api.telegram.org/file/bot${telegramToken}/${path}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!audio.ok) return null;
      const form = new FormData();
      form.append("file", new Blob([await audio.arrayBuffer()]), "voice.ogg");
      form.append("model", "whisper-large-v3-turbo");
      form.append("response_format", "json");
      if (language) form.append("language", language);
      const response = await transport("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${groqKey}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        console.error(`Groq transcription: HTTP ${response.status}`);
        return null;
      }
      const text = ((await response.json()) as any)?.text;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    } catch (e) {
      console.error(`Groq transcription: ${e instanceof Error ? e.name : "error"}`);
      return null;
    }
  };
}
