export class DeepgramTTS {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is missing in environment variables.");
    }
  }

  async *synthesize(textStream: AsyncIterable<string>): AsyncIterable<Buffer> {
    for await (const textChunk of textStream) {
      if (!textChunk.trim()) continue;

      // Notice the URL: We specifically request 48kHz linear16 audio so we don't have to upsample later!
      const url =
        "https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=24000&container=none";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: textChunk }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Deepgram TTS Error:", errorText);
        throw new Error(`Deepgram TTS Failed: ${response.statusText}`);
      }

      if (response.body) {
        // Node 18+ native fetch streams the response body
        // @ts-ignore - TS sometimes complains about async iterating response.body, but it works in Node 18+
        for await (const chunk of response.body) {
          yield Buffer.from(chunk);
        }
      }
    }
  }
}
