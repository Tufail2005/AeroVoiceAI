import { EventEmitter } from "events";
import type { STTEngine } from "../AgentRouter.js";
import WebSocket from "ws";

export class LocalWhisperSTT extends EventEmitter implements STTEngine {
  async startListening(audioStream: AsyncIterable<any>) {
    // Connect to the Python FastAPI Faster-Whisper server we will build next
    const ws = new WebSocket("ws://127.0.0.1:8000/listen");

    ws.on("open", async () => {
      console.log("🔌 Local Faster-Whisper WebSocket connected. Listening...");
      try {
        for await (const frame of audioStream) {
          if (ws.readyState === WebSocket.OPEN) {
            // Extract the raw PCM buffer from the LiveKit audio frame
            const buffer = Buffer.from(
              frame.data.buffer,
              frame.data.byteOffset,
              frame.data.byteLength
            );
            ws.send(buffer);
          }
        }
      } catch (err) {
        console.error("Audio stream broken:", err);
      }
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());

        // Emulate the "UtteranceEnd" logic from Deepgram
        if (parsed.type === "UtteranceEnd" && parsed.text.trim().length > 0) {
          console.log(
            `\n✅ Local Full User Turn Detected: "${parsed.text.trim()}"`
          );

          // Broadcast the full sentence to the Orchestrator
          this.emit("transcriptReady", parsed.text.trim());
        } else if (parsed.type === "Partial") {
          process.stdout.write(`\r🗣️ Hearing (Local): "${parsed.text}"`);
        }
      } catch (e) {
        console.error("Failed to parse Whisper socket message", e);
      }
    });

    ws.on("error", (err) => {
      console.error("❌ Local Whisper STT error:", err);
    });
  }
}
