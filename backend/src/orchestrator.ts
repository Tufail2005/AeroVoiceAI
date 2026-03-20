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

// INITIALIZATION: Load credentials from .env file
dotenv.config();

async function startOrchestrator() {
  // Initialize the Room object which represents the WebRTC session
  const room = new Room();
  const sttEngine = new DeepgramSTT();

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
          // Pass the live stream directly to our STT Engine
          const fullSessionTranscript = await sttEngine.transcribe(audioStream);
          console.log(`\n📜 Full Session Transcript: ${fullSessionTranscript}`);
        } catch (error) {
          console.error("Transcription pipeline failed:", error);
        }
      }
    }
  );

  console.log("Connecting to LiveKit Room...");

  const apiKey = process.env.LIVEKIT_API_KEY!.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET!.trim();
  const livekitUrl = process.env.LIVEKIT_URL!.trim();

  // Generate a JWT (JSON Web Token) using your API Key and Secret
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
