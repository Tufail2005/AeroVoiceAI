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
    });

    let currentUtterance = "";
    let isStreamLocked = false;

    live.on("open", async () => {
      console.log("🔌 Deepgram WebSocket connected. Listening...");

      if (isStreamLocked) return;
      isStreamLocked = true;

      try {
        for await (const frame of audioStream) {
          const buffer = Buffer.from(
            frame.data.buffer,
            frame.data.byteOffset,
            frame.data.byteLength
          );

          const liveSocket = (live as any).socket;
          if (liveSocket && liveSocket.readyState === 1) {
            liveSocket.send(buffer);
          }
        }
      } catch (err) {
        console.error("Audio stream broken:", err);
      }
    });

    live.on("message", (data: any) => {
      if (data.type === "Results") {
        const words = data.channel.alternatives[0].transcript;

        if (words) {
          if (data.is_final) {
            currentUtterance += words + " ";
            console.log(`\n🧩 Chunk locked: "${words}"`);
          } else {
            process.stdout.write(`\r🗣️ Hearing: "${currentUtterance}${words}"`);
          }
        }
      }

      if (data.type === "UtteranceEnd") {
        if (currentUtterance.trim().length > 0) {
          console.log(
            `\n✅ Full User Turn Detected: "${currentUtterance.trim()}"`
          );
          this.emit("transcriptReady", currentUtterance.trim());
          currentUtterance = "";
        }
      }
    });

    live.on("error", (err: any) => {
      console.error("Deepgram error:", err);
    });
  }
}
