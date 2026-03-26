import type { TTSEngine } from "./AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

export class ElevenLabsTTS implements TTSEngine {
  async *synthesize(textStream: AsyncIterable<string>): AsyncIterable<Buffer> {
    for await (const sentence of textStream) {
      console.log(`\n🎙️ Synthesizing Voice: "${sentence}"`);

      // We use ElevenLabs Turbo v2.5 for the lowest possible latency
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/ym92qQ1r4jR6MUGuKNnk/stream?output_format=pcm_24000&optimize_streaming_latency=3`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: sentence,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `\n❌ ElevenLabs API Error (${response.status}):`,
          errorText
        );
        throw new Error("ElevenLabs TTS Failed");
      }

      if (!response.body) {
        throw new Error("No response body from ElevenLabs");
      }

      // Convert the Web ReadableStream into an AsyncIterable for Node.js
      // As chunks of raw audio arrive over HTTP, yield them instantly
      for await (const chunk of response.body as any) {
        yield Buffer.from(chunk);
      }
    }
  }
}
