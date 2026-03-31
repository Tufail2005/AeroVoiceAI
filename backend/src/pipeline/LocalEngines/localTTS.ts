import type { TTSEngine } from "../AgentRouter.js";

export class LocalKokoroTTS implements TTSEngine {
  async *synthesize(textStream: AsyncIterable<string>): AsyncIterable<Buffer> {
    for await (const sentence of textStream) {
      console.log(`\n🎙️ Local Voice Synthesizing: "${sentence}"`);

      // Hitting the local Docker container running Kokoro
      const response = await fetch("http://127.0.0.1:5050/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "kokoro",
          input: sentence,
          voice: "af_heart", // A standard high-quality Kokoro voice
          response_format: "pcm", // Request raw PCM to match your LiveKit sink
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `\n❌ Local Kokoro TTS Error (${response.status}):`,
          errorText
        );
        throw new Error("Local TTS Failed");
      }

      if (!response.body) {
        throw new Error("No response body from Local TTS");
      }

      // Stream the raw PCM chunks back to the Orchestrator instantly
      for await (const chunk of response.body as any) {
        yield Buffer.from(chunk);
      }
    }
  }
}
