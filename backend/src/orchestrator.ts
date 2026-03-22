import {
  Room,
  RoomEvent,
  type RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  AudioStream,
  TrackKind,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import dotenv from "dotenv";

import { DeepgramSTT } from "./pipeline/DeepgramSTT.js";
import { GroqLLM } from "./pipeline/GroqLLM.js";
import type { Message } from "./pipeline/AgentRouter.js";

dotenv.config();

async function startOrchestrator() {
  const room = new Room();
  const sttEngine = new DeepgramSTT();
  const llmEngine = new GroqLLM(); // 🧠 Instantiate the Brain

  // System prompt to constrain the AI's behavior
  const conversationHistory: Message[] = [
    {
      role: "system",
      content:
        "You are Aero, a highly capable, concise AI assistant. Keep all responses under 2 sentences to ensure fast voice playback.",
    },
  ];

  room.on(
    RoomEvent.TrackSubscribed,
    async (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(
          `🎧 Subscribed to audio from ${participant.identity}. Hooking up Deepgram...`
        );

        const audioStream = new AudioStream(track);
        let isProcessingTurn = false; // Prevents the AI from listening to itself or background noise while talking

        // 1. Start listening continuously
        sttEngine.startListening(audioStream);

        // 2. When the user finishes a sentence, trigger the Brain
        sttEngine.on("transcriptReady", async (userTranscript: string) => {
          if (isProcessingTurn) return;
          isProcessingTurn = true;

          // Save what the user said to memory
          conversationHistory.push({ role: "user", content: userTranscript });

          process.stdout.write("🤖 Aero says: ");
          let fullAiResponse = "";

          try {
            // 3. Consume the AsyncIterable stream as tokens arrive from Groq
            for await (const token of llmEngine.generate(conversationHistory)) {
              process.stdout.write(token); // Print token instantly to the console
              fullAiResponse += token;
            }
            console.log("\n"); // Cap off the sentence in the console

            // Save the AI's final response to memory
            conversationHistory.push({
              role: "assistant",
              content: fullAiResponse,
            });
          } catch (error) {
            console.error("LLM Error:", error);
          } finally {
            console.log("\n👂 Ear is active. Waiting for you to speak...");
            isProcessingTurn = false; // Unlock for the next turn
          }
        });
      }
    }
  );

  console.log("Connecting to LiveKit Room...");

  const apiKey = process.env.LIVEKIT_API_KEY!.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET!.trim();

  // Generate a JWT
  const token = new AccessToken(apiKey, apiSecret, {
    identity: "orchestrator-backend",
    name: "AeroVoiceAI Brain",
  });

  // Grant the bot permission to join, speak, and listen in the specific room
  token.addGrant({
    roomJoin: true,
    room: "aerovoice-room",
    canPublish: true,
    canSubscribe: true,
  });

  const jwtToken = await token.toJwt();

  // Establish the WebRTC connection to the LiveKit server
  await room.connect(process.env.LIVEKIT_URL!, jwtToken, {
    autoSubscribe: true, // Automatically listen to anyone who joins
    dynacast: false, // Disable adaptive bitrate (not needed for simple audio bots)
  });

  console.log(
    "✅ Orchestrator connected successfully! Waiting for user to join..."
  );
}

// Start the process and catch any top-level errors (e.g., invalid credentials)
startOrchestrator().catch(console.error);
