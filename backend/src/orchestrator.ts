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
import { type Message } from "./pipeline/AgentRouter.js";

// INITIALIZATION: Load credentials from .env file
dotenv.config();

// Define the initial system prompt to give your bot a personality
const conversationHistory: Message[] = [
  {
    role: "system",
    content:
      "You are AeroVoice, a highly helpful, concise, and friendly AI voice assistant. Keep your responses short and natural for spoken conversation.",
  },
];

async function startOrchestrator() {
  // Initialize the Room object which represents the WebRTC session
  const room = new Room();

  // Initialize our engines
  const sttEngine = new DeepgramSTT();
  const llmEngine = new GroqLLM();

  //  EVENT LISTENER
  room.on(
    RoomEvent.TrackSubscribed,
    async (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      // We only care about Audio tracks
      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(
          `🎧 Subscribed to audio from ${participant.identity}. Hooking up Deepgram...`
        );

        // INGRESS: Create a stream to read raw PCM audio data
        const audioStream = new AudioStream(track);

        try {
          // EAR: Pass the live stream to STT Engine and wait for the user to finish speaking
          const userText = await sttEngine.transcribe(audioStream);
          console.log(`\n📜 User said: ${userText}`);

          // Append user's speech to the history
          conversationHistory.push({ role: "user", content: userText });

          console.log("🤔 Sending to Groq...");

          // BRAIN: Call the LLM and get the streaming response
          const responseStream = llmEngine.generate(conversationHistory);

          let fullAssistantResponse = "";
          process.stdout.write("🤖 AeroVoice: ");

          // Consume the async generator as tokens arrive for that "typing" effect
          for await (const token of responseStream) {
            process.stdout.write(token);
            fullAssistantResponse += token;
          }
          console.log("\n"); // Print a new line when the bot finishes

          // Append the bot's final response back to the history so it remembers the context
          conversationHistory.push({
            role: "assistant",
            content: fullAssistantResponse,
          });
        } catch (error) {
          console.error("pipeline failed:", error);
        }
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
