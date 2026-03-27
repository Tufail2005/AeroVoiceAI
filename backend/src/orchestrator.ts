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

// import RAG worker
import { Worker } from "worker_threads";
import { Writable } from "stream";
import { pipeline as streamPipeline } from "stream/promises";
import { Readable } from "stream";

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
      content: `You are Aero, a highly capable and ultra-concise AI assistant. 
        Strict Rules:
        1. Answer ONLY the exact question asked. 
        2. Provide zero additional context, background information, dates, or conversational filler.
        3. If the user asks a simple factual question,your response must be a single, direct sentence.
         Example: User: Who was the first prime minister of India?,
         Aero: Jawaharlal Nehru was the first Prime Minister of India.
       You MUST spell out all numbers, years, and symbols exactly as they are spoken. 
       For example, write "nineteen ninety eight" instead of "1998". 
       Write "twenty dollars" instead of "$20". 
       Write "one hundred percent" instead of "100%". 
       Never use special characters like &, %, $, or #.

          `,
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
  // RAG INITIALIZATION (Worker Thread Setup)
  // ==========================================
  console.log("🧠 Spinning up RAG Worker Thread...");
  // Dynamically determine if we are running the .ts file (dev) or .js file (prod)
  const isTsEnv = import.meta.url.endsWith(".ts");
  const workerPath = isTsEnv
    ? "./pipeline/ragWorker.ts"
    : "./pipeline/ragWorker.js";

  // If in TS environment, we must explicitly tell the new thread to use the 'tsx' loader
  const workerOptions = isTsEnv
    ? { execArgv: ["--experimental-strip-types", "--no-warnings"] }
    : {};

  console.log("🧠 Spinning up RAG Worker Thread...");
  const ragWorker = new Worker(
    new URL(workerPath, import.meta.url),
    workerOptions
  );

  // A helper function to wrap the worker message passing in a Promise
  const queryRagWorker = (
    text: string
  ): Promise<{ bestChunk: string; highestScore: number }> => {
    return new Promise((resolve, reject) => {
      const onMessage = (msg: any) => {
        if (msg.type === "RESULT") {
          ragWorker.off("message", onMessage);
          resolve({ bestChunk: msg.bestChunk, highestScore: msg.highestScore });
        } else if (msg.type === "ERROR") {
          ragWorker.off("message", onMessage);
          reject(msg.error);
        }
      };
      ragWorker.on("message", onMessage);
      ragWorker.postMessage({ type: "QUERY", text });
    });
  };

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

        // Publish the AI's voice track back to the user
        //Checks if the AI bot is fully connected to the room.
        if (room.localParticipant) {
          //Tells LiveKit to treat the AI's artificial audio track as if it were a standard human microphone
          const options = new TrackPublishOptions();
          options.source = TrackSource.SOURCE_MICROPHONE;
          await room.localParticipant.publishTrack(aiTrack, options); //The bot immediately publishes its own "ai-voice" track back to the room so the human can hear it.
          console.log("📢 AI Voice track published successfully.");
        }

        // ======================================
        //                  STT
        // ======================================
        const audioStream = new AudioStream(track); //Grabs the live audio feed coming from the human's mic.
        let isProcessingTurn = false; // Prevents the AI from try to answer a new question while it's still talking.

        // Start the continuous STT listener
        sttEngine.startListening(audioStream);

        // React to completed sentences after deepgram code emit give green signal
        sttEngine.on("transcriptReady", async (userTranscript: string) => {
          if (isProcessingTurn) return;
          isProcessingTurn = true;

          // conversationHistory.push({ role: "user", content: userTranscript });
          process.stdout.write("🤖 Aero says: "); //printing text to terminal

          try {
            // ===================================
            // NON-BLOCKING RAG LOOKUP
            // ====================================
            // We pass the text to the Worker. The main loop stays unblocked!
            const { bestChunk, highestScore } = await queryRagWorker(
              userTranscript
            );

            //  Silently inject the knowledge into the LLM context if it's relevant
            // (A score of 0.3 or higher usually implies a decent semantic match)
            let promptToSend = userTranscript;
            if (highestScore > 0.3) {
              promptToSend = `Use the following context to answer the user if relevant: "${bestChunk}".\n\nUser Question: ${userTranscript}`;
              console.log(
                `\n[🔍 RAG Match Found: Score ${highestScore.toFixed(2)}]`
              );
            }
            // Push the contextualized prompt to memory (but we won't speak the hidden context out loud)
            conversationHistory.push({ role: "user", content: promptToSend });

            // ==============================
            //         core "brain"
            // --- THE STREAMING PIPELINE ---
            // ==============================
            const rawTokens = llmEngine.generate(conversationHistory);
            const cleanSentences = chunkTextStream(rawTokens);
            const audioChunks = ttsEngine.synthesize(cleanSentences);

            // ==========================================
            //          NATIVE BACKPRESSURE SINK
            // ==========================================

            let lingeringBuffer = Buffer.alloc(0);
            const IN_BYTES_PER_FRAME = 480;
            /*   The Math: ElevenLabs sends audio at a sample rate of 24,000 samples per second (24kHz). We want to process audio in exactly 10-millisecond chunks.
              10ms of 24,000 samples = 240 samples.
              Because it is 16-bit audio, every sample takes up 2 bytes.
              240 samples × 2 bytes = 480 bytes.
           */

            const webrtcSink = new Writable({
              async write(chunk, encoding, callback) {
                lingeringBuffer = Buffer.concat([lingeringBuffer, chunk]);

                try {
                  while (lingeringBuffer.length >= IN_BYTES_PER_FRAME) {
                    const frameData = lingeringBuffer.subarray(
                      0,
                      IN_BYTES_PER_FRAME
                    );
                    lingeringBuffer =
                      lingeringBuffer.subarray(IN_BYTES_PER_FRAME);

                    const cleanBuffer = Buffer.from(frameData);
                    const int16Data24kHz = new Int16Array(
                      cleanBuffer.buffer,
                      cleanBuffer.byteOffset,
                      cleanBuffer.byteLength / 2
                    );

                    // --- THE UPSAMPLER (24kHz -> 48kHz) ---
                    const int16Data48kHz = new Int16Array(480);
                    for (let i = 0; i < 240; i++) {
                      const sample = int16Data24kHz[i] ?? 0;
                      int16Data48kHz[i * 2] = sample;
                      int16Data48kHz[i * 2 + 1] = sample;
                    }

                    const frame = new AudioFrame(
                      int16Data48kHz,
                      LIVEKIT_SAMPLE_RATE,
                      NUM_CHANNELS,
                      480
                    );

                    // 🔥 By awaiting this, LiveKit applies native backpressure.
                    // If the socket is full, Node automatically pauses pulling from ElevenLabs!
                    await audioSource.captureFrame(frame);
                  }

                  // Tell Node's stream pipeline we are ready for the next audio chunk
                  callback();
                } catch (err: any) {
                  callback(err);
                }
              },
            });

            // ==========================================
            // 4. EXECUTE THE PIPE
            // ==========================================
            // Safely push ElevenLabs data into the WebRTC Sink
            await streamPipeline(Readable.from(audioChunks), webrtcSink);

            console.log("\n");
            conversationHistory.push({
              role: "assistant",
              content: "Aero responded.",
            });
          } catch (error) {
            console.error("Pipeline Error:", error);
          } finally {
            console.log("\n👂 Ear is active. Waiting for you to speak...");
            isProcessingTurn = false;
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
