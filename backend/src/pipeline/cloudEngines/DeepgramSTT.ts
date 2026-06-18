import { DeepgramClient } from "@deepgram/sdk";
import { EventEmitter } from "events";
import type { STTEngine } from "../AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

export class DeepgramSTT extends EventEmitter implements STTEngine {
  private deepgram = new DeepgramClient({
    apiKey: process.env.DEEPGRAM_API_KEY,
  });

  async startListening(audioStream: AsyncIterable<any>) {
    const live = await this.deepgram.listen.v1.connect({
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      model: "nova-3",
      language: "en-IN",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: 48000,
      channels: 1,
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
    } as any);

    let currentUtterance = "";
    let isStreamLocked = false;

    live.on("open", async () => {
      console.log("🔌 Deepgram WebSocket connected. Listening...");

      if (isStreamLocked) return;
      isStreamLocked = true;

      try {
        for await (const frame of audioStream) {
          const liveSocket = (live as any).socket;
          if (liveSocket && liveSocket.readyState === 1) {
            const buffer = Buffer.from(
              frame.data.buffer,
              frame.data.byteOffset,
              frame.data.byteLength
            );

            liveSocket.send(buffer);
          }
        }
      } catch (err) {
        console.error("Audio stream broken:", err);
      }
    });

    live.on("message", (rawData: any) => {
      // Safely ensure it's an object
      let data = rawData;
      if (Buffer.isBuffer(rawData)) {
        data = JSON.parse(rawData.toString());
      } else if (typeof rawData === "string") {
        data = JSON.parse(rawData);
      }

      // Safely dig into the object to find the words
      const words = data?.channel?.alternatives?.[0]?.transcript;

      // 1. Handle incoming words
      if (words) {
        if (data.is_final) {
          currentUtterance += words + " ";
          console.log(`\n🧩 Chunk locked: "${words}"`);
        } else {
          process.stdout.write(`\r🗣️ Hearing: "${currentUtterance}${words}"`);
        }
      }

      // 2. Handle the End of Turn trigger
      if (data?.type === "UtteranceEnd") {
        if (currentUtterance.trim().length > 0) {
          console.log(
            `\n✅ Full User Turn Detected: "${currentUtterance.trim()}"`
          );

          // Emit the event to wake up the Orchestrator
          this.emit("transcriptReady", currentUtterance.trim());

          currentUtterance = "";
        }
      }
    });

    live.on("error", (err: any) => {
      console.error("Deepgram error:", err);
    });

    try {
      live.connect();
    } catch (err) {
      console.error("❌ Failed to connect Deepgram WebSocket:", err);
    }
  }
}
