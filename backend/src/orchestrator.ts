import {
  Room,
  RoomEvent,
  type RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  AudioStream,
  AudioSource,
  LocalAudioTrack,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import dotenv from "dotenv";

// 1. INITIALIZATION: Load credentials from .env file
dotenv.config();

async function startOrchestrator() {
  // Initialize the Room object which represents the WebRTC session
  const room = new Room();

  /**
   * EVENT LISTENER: TrackSubscribed
   * This triggers whenever the backend successfully starts receiving
   * a media track (audio/video) from another participant.
   */
  room.on(
    RoomEvent.TrackSubscribed,
    async (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      // We only care about Audio tracks for an Echo test
      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(
          `🎧 Subscribed to audio from ${participant.identity}. Starting Echo Test...`
        );

        // INGRESS: Create a stream to read raw PCM audio data from the subscribed track
        const audioStream = new AudioStream(track);

        // EGRESS: Create a source to push audio back into the LiveKit room
        // 48000 Hz, 1 channel (Mono) is the standard high-quality setting for WebRTC
        const audioSource = new AudioSource(48000, 1);
        const echoTrack = LocalAudioTrack.createAudioTrack(
          "echo-track",
          audioSource
        );

        // PUBLISH: Make the echo track visible/audible to others in the room
        if (room.localParticipant) {
          const options = new TrackPublishOptions();
          options.source = TrackSource.SOURCE_MICROPHONE;

          room.localParticipant.publishTrack(echoTrack, options).then(() => {
            console.log("📢 Echo track published back to the user.");
          });
        }

        /**
         * THE ECHO LOOP
         * This "pumps" audio frames. It takes a frame from the incoming stream
         * and immediately captures it into our outgoing source.
         */
        try {
          // This async iterator waits for each new audio buffer chunk
          for await (const frame of audioStream) {
            await audioSource.captureFrame(frame);
          }
        } catch (error) {
          console.error("Error pumping audio frame:", error);
        } finally {
          // CLEANUP: If the user leaves or the stream ends, unpublish the track
          console.log(
            `🔇 Audio stream ended for ${participant.identity}. Stopping Echo.`
          );
          if (room.localParticipant && echoTrack.sid) {
            await room.localParticipant.unpublishTrack(echoTrack.sid);
          }
        }
      }
    }
  );

  /**
   * CONNECTION LOGIC
   * The backend must authenticate itself just like a frontend client.
   */
  console.log("Connecting to LiveKit Room...");

  const apiKey = process.env.LIVEKIT_API_KEY!.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET!.trim();
  const livekitUrl = process.env.LIVEKIT_URL!.trim();

  // Generate a JWT (JSON Web Token) using your API Key and Secret
  const token = new AccessToken(apiKey, apiSecret, {
    identity: "orchestrator-backend", // Unique ID for the bot
    name: "AeroVoiceAI Brain", // Display name
    ttl: "10m",
  });

  // Grant the bot permission to join, speak, and listen in the specific room
  token.addGrant({
    roomJoin: true,
    room: "aerovoice-room",
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
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
