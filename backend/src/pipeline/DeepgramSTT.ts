import { DeepgramClient } from "@deepgram/sdk";
import { EventEmitter } from "events";
import type { STTEngine } from "./AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

// Extend EventEmitter to broadcast completed sentences to the Orchestrator
export class DeepgramSTT extends EventEmitter implements STTEngine {
  // v5 Initialization
  private deepgram = new DeepgramClient({
    apiKey: process.env.DEEPGRAM_API_KEY,
  });

  // Changed from transcribe() to startListening()
  async startListening(audioStream: AsyncIterable<any>) {
    // Initialize the real-time WebSocket connection to Nova-3 (v5 syntax)
    const live = await this.deepgram.listen.v1.connect({
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      model: "nova-3",
      language: "en-IN",
      smart_format: "true",
      encoding: "linear16", // WebRTC raw PCM format
      sample_rate: 48000, // LiveKit default sample rate
      channels: 1, // Mono audio
      interim_results: "true", // Get words as they are spoken
      endpointing: "300", // Passed as strings for TypeScript ConnectArgs
      utterance_end_ms: "1000",
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
        console.error("Audio stream broken:", err);
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
            process.stdout.write(`\r🗣️ Hearing: "${currentUtterance}${words}"`);
          }
        }
      }

      // Listen for the silence trigger!
      if (data.type === "UtteranceEnd") {
        if (currentUtterance.trim().length > 0) {
          console.log(
            `\n✅ Full User Turn Detected: "${currentUtterance.trim()}"`
          );

          // 🔥 EVENT EMITTER: Broadcast the full sentence to the Orchestrator!
          this.emit("transcriptReady", currentUtterance.trim());

          // Reset the accumulator for the next time they speak
          currentUtterance = "";
        }
      }
    });

    live.on("error", (err: any) => {
      console.error("Deepgram error:", err);
    });

    // Connect the socket explicitly (Required in v5)
    try {
      live.connect();
      await live.waitForOpen();
    } catch (err) {
      console.error(
        "❌ Failed to open Deepgram WebSocket. Check your config values:",
        err
      );
    }
  }
}
