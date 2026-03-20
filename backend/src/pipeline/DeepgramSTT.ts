import { DeepgramClient } from "@deepgram/sdk";
import type { STTEngine } from "./AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

export class DeepgramSTT implements STTEngine {
  // v5 Initialization: Use DeepgramClient instead of createClient
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
      });

      let finalTranscript = "";

      // v5 Events: Standard string literals instead of LiveTranscriptionEvents
      live.on("open", async () => {
        console.log("🔌 Deepgram WebSocket connected. Listening...");

        try {
          // Pump the LiveKit audio frames directly into the Deepgram socket
          for await (const frame of audioStream) {
            // v5 requires addressing the socket to send raw buffer data
            if (live.socket) {
              live.socket.send(frame.data);
            }
          }
          // If the stream breaks/ends, close the connection
          if (live.socket) live.socket.close();
        } catch (err) {
          console.error("Error piping audio to Deepgram:", err);
          reject(err);
        }
      });

      // Handle incoming transcriptions in real-time
      live.on("message", (data: any) => {
        // v5 requires manually checking if the message is a "Results" payload
        if (data.type === "Results") {
          const words = data.channel.alternatives[0].transcript;

          if (words) {
            // interim_results gives us the real-time "typing" effect
            if (data.is_final) {
              finalTranscript += words + " ";
              console.log(`\n✅ Finalized Segment: "${words}"`);
            } else {
              process.stdout.write(`\r🗣️ Hearing: "${words}"`);
            }
          }
        }
      });

      live.on("close", () => {
        console.log("\n🔌 Deepgram connection closed.");
        resolve(finalTranscript.trim());
      });

      live.on("error", (err: any) => {
        console.error("Deepgram error:", err);
        reject(err);
      });

      // In v5, we must explicitly tell the client to connect and wait
      live.connect();
      await live.waitForOpen();
    });
  }
}
