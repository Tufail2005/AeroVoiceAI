import {
  Room,
  RoomEvent,
  type RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  AudioStream,
  TrackKind,
  AudioSource,
  LocalAudioTrack,
  TrackSource,
  TrackPublishOptions,
  AudioFrame,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import dotenv from "dotenv";

// Import the Pipeline Engines
import { DeepgramSTT } from "./pipeline/DeepgramSTT.js";
import { GroqLLM } from "./pipeline/GroqLLM.js";
import { ElevenLabsTTS } from "./pipeline/ElevenLabTTS.js";
import { chunkTextStream } from "./pipeline/TextChunker.js";
import type { Message } from "./pipeline/AgentRouter.js";

dotenv.config();

async function startOrchestrator() {
  const room = new Room();

  // Instantiate the Engines
  const sttEngine = new DeepgramSTT();
  const llmEngine = new GroqLLM();
  const ttsEngine = new ElevenLabsTTS();

  // The AI's Memory
  const conversationHistory: Message[] = [
    {
      role: "system",
      content:
        "You are Aero, a highly capable, concise AI assistant. Keep all responses under 2 sentences to ensure fast voice playback.",
    },
  ];

  // ==========================================
  // EGRESS SETUP: Create the AI's "Mouth"
  // ==========================================
  // We force WebRTC's native 48kHz for the highest quality and stability
  const LIVEKIT_SAMPLE_RATE = 48000;
  const NUM_CHANNELS = 1;
  const audioSource = new AudioSource(LIVEKIT_SAMPLE_RATE, NUM_CHANNELS);
  const aiTrack = LocalAudioTrack.createAudioTrack("ai-voice", audioSource);

  // ==========================================
  // INGRESS & PIPELINE EXECUTION
  // ==========================================
  room.on(
    RoomEvent.TrackSubscribed,
    async (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(`🎧 Subscribed to audio from ${participant.identity}.`);

        // 1. Publish the AI's voice track back to the user
        if (room.localParticipant) {
          const options = new TrackPublishOptions();
          options.source = TrackSource.SOURCE_MICROPHONE;
          await room.localParticipant.publishTrack(aiTrack, options);
          console.log("📢 AI Voice track published successfully.");
        }

        const audioStream = new AudioStream(track);
        let isProcessingTurn = false; // Prevents the AI from overlapping itself

        // 2. Start the continuous STT listener
        sttEngine.startListening(audioStream);

        // 3. React to completed sentences
        sttEngine.on("transcriptReady", async (userTranscript: string) => {
          if (isProcessingTurn) return;
          isProcessingTurn = true;

          conversationHistory.push({ role: "user", content: userTranscript });
          process.stdout.write("🤖 Aero says: ");

          try {
            // --- THE STREAMING PIPELINE ---
            const rawTokens = llmEngine.generate(conversationHistory);
            const cleanSentences = chunkTextStream(rawTokens);
            const audioChunks = ttsEngine.synthesize(cleanSentences);

            let audioBuffer = Buffer.alloc(0);

            // --- THE DRIFT-FREE PACER SETUP ---
            let framesSent = 0;
            const playoutStartTime = Date.now();

            // ElevenLabs gives us 24kHz audio. 10ms of 24kHz = 240 samples = 480 bytes
            const IN_BYTES_PER_FRAME = 480;

            // --- THE AUDIO PUMP ---
            for await (const chunk of audioChunks) {
              audioBuffer = Buffer.concat([audioBuffer, chunk]);

              while (audioBuffer.length >= IN_BYTES_PER_FRAME) {
                // Slice exactly 10ms of 24kHz audio
                const frameData = audioBuffer.subarray(0, IN_BYTES_PER_FRAME);
                audioBuffer = audioBuffer.subarray(IN_BYTES_PER_FRAME);

                // Safely align the memory buffer
                const cleanBuffer = Buffer.from(frameData);

                // Cast to 16-bit integers (24kHz)
                const int16Data24kHz = new Int16Array(
                  cleanBuffer.buffer,
                  cleanBuffer.byteOffset,
                  cleanBuffer.byteLength / 2
                );

                // --- THE UPSAMPLER (24kHz -> 48kHz) ---
                // We double the samples to match LiveKit's native preference
                const int16Data48kHz = new Int16Array(480);
                for (let i = 0; i < 240; i++) {
                  const sample = int16Data24kHz[i] ?? 0;
                  int16Data48kHz[i * 2] = sample;
                  int16Data48kHz[i * 2 + 1] = sample;
                }

                // Create the LiveKit AudioFrame
                const frame = new AudioFrame(
                  int16Data48kHz,
                  LIVEKIT_SAMPLE_RATE,
                  NUM_CHANNELS,
                  480 // Samples per channel
                );

                // Send the frame to WebRTC
                await audioSource.captureFrame(frame);

                // --- THE PACER EXECUTION ---
                framesSent++;
                const expectedTime = playoutStartTime + framesSent * 10; // 10ms per frame
                const currentTime = Date.now();
                const sleepTime = expectedTime - currentTime;

                // Prevent Socket Blasting by sleeping if we generate faster than real-time
                if (sleepTime > 0) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, sleepTime)
                  );
                }
              }
            }

            console.log("\n");
            // Save the turn to memory so the AI has context for the next question
            // (In a perfect world, we'd rebuild the string from the tokens, but this works for now)
            conversationHistory.push({
              role: "assistant",
              content: "Aero responded.",
            });
          } catch (error) {
            console.error("Pipeline Error:", error);
          } finally {
            console.log("\n👂 Ear is active. Waiting for you to speak...");
            isProcessingTurn = false; // Unlock for the next turn
          }
        });
      }
    }
  );

  // ==========================================
  // CONNECTION LOGIC
  // ==========================================
  console.log("Connecting to LiveKit Room...");

  const apiKey = process.env.LIVEKIT_API_KEY!.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET!.trim();

  // Generate a JWT for the Orchestrator
  const token = new AccessToken(apiKey, apiSecret, {
    identity: "orchestrator-backend",
    name: "AeroVoiceAI Brain",
  });

  token.addGrant({
    roomJoin: true,
    room: "aerovoice-room",
    canPublish: true,
    canSubscribe: true,
  });

  const jwtToken = await token.toJwt();

  await room.connect(process.env.LIVEKIT_URL!, jwtToken, {
    autoSubscribe: true,
    dynacast: false,
  });

  console.log(
    "✅ Orchestrator connected successfully! Waiting for user to join..."
  );
}

startOrchestrator().catch(console.error);
