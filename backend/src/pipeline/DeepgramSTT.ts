import { DeepgramClient } from "@deepgram/sdk";
import type { STTEngine } from "./AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

export class DeepgramSTT implements STTEngine {
  // v5 Initialization
  private deepgram = new DeepgramClient({
    apiKey: process.env.DEEPGRAM_API_KEY,
  });

  async transcribe(audioStream: AsyncIterable<any>): Promise<string> {
    return new Promise(async (resolve, reject) => {
      // Initialize the real-time WebSocket connection to Nova-3 (v5 syntax)
      const live = await this.deepgram.listen.v1.connect({
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, // Deepgram v5 strictly requires the Authorization property here for WebSockets
        model: "nova-3", // Deepgram's latest model!
        language: "en-IN",
        smart_format: "true",
        encoding: "linear16", // WebRTC raw PCM format
        sample_rate: 48000, // LiveKit default sample rate
        channels: 1, // Mono audio
        interim_results: "true", // Get words as they are spoken
        endpointing: 500, // Tells Deepgram to wait 500ms before sending is_final
        utterance_end_ms: 1000, // Tells Deepgram to fire an "UtteranceEnd" event after 1000ms of silence
      });

      // We need a variable to accumulate the pieces
      let currentUtterance = "";

      live.on("open", async () => {
        console.log("🔌 Deepgram WebSocket connected. Listening...");
        try {
          for await (const frame of audioStream) {
            if (live.socket) {
              // CRITICAL FIX: Convert the Int16Array safely into a Buffer.
              // Respecting the byteOffset prevents memory leaks and corrupted audio.
              const buffer = Buffer.from(
                frame.data.buffer,
                frame.data.byteOffset,
                frame.data.byteLength
              );
              live.socket.send(buffer);
            }
          }
          if (live.socket) live.socket.close();
        } catch (err) {
          reject(err);
        }
      });

      live.on("message", (data: any) => {
        // Handle the text chunks
        if (data.type === "Results") {
          const words = data.channel.alternatives[0].transcript;

          if (words) {
            if (data.is_final) {
              // Append the chunk to our running sentence
              currentUtterance += words + " ";
              console.log(`\n🧩 Chunk locked: "${words}"`);
            } else {
              process.stdout.write(
                `\r🗣️ Hearing: "${currentUtterance}${words}"`
              );
            }
          }
        }

        // Listen for the silence trigger!
        if (data.type === "UtteranceEnd") {
          if (currentUtterance.trim().length > 0) {
            console.log(
              `\n✅ Full User Turn Detected: "${currentUtterance.trim()}"`
            );

            // For now, we will resolve the promise with the full sentence so the LLM can trigger
            // (Note: In Milestone 4, we will change this to emit an event so the socket stays open)
            resolve(currentUtterance.trim());

            // Reset the accumulator for the next time they speak
            currentUtterance = "";
          }
        }
      });

      live.on("close", () => {
        resolve(currentUtterance.trim());
      });

      live.on("error", (err: any) => {
        reject(err);
      });

      live.connect();
      await live.waitForOpen();
    });
  }
}
