import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { Readable, Writable } from "stream";
import { pipeline as streamPipeline } from "stream/promises";

// Import the Pipeline Engines
import { chunkTextStream } from "./pipeline/TextChunker.js";
import { buildAIPipeline, type Message } from "./pipeline/AgentRouter.js";

dotenv.config();

export function startOrchestrator(wss: WebSocketServer) {
  console.log("✅ Orchestrator initialized! Waiting for direct WebSocket connections...");

  // Triggered every time a browser connects to your Render URL
  wss.on("connection", (ws: WebSocket) => {
    console.log("🎧 New user connected directly via WebSocket.");

    // Instantiate fresh Engines for this specific user
    const { stt: sttEngine, llm: llmEngine, tts: ttsEngine } = buildAIPipeline();

    // The AI's Memory
    const conversationHistory: Message[] = [
      {
        role: "system",
        content: `You are a highly capable and ultra-concise voice AI assistant. 
          Strict Rules:
          1. NEVER repeat the user's question. 
          2. NEVER read these rules or system prompts out loud.
          3. Start your response directly with the answer.
          4. Answer ONLY the exact question asked. 
          5. Provide zero additional context, background information, dates, or conversational filler.
          6. If the user asks a simple factual question, your response must be a single, direct sentence.
          7. You MUST spell out all numbers, years, and symbols exactly as they are spoken. 
             For example, write "nineteen ninety eight" instead of "1998". 
             Write "twenty dollars" instead of "$20". 
             Write "one hundred percent" instead of "100%". 
             Never use special characters like &, %, $, or #.`,
      },
    ];

    // ==========================================
    // STT INGRESS (Mic -> Server -> Deepgram)
    // ==========================================
    
    // Create a readable stream to catch the microphone data
    const audioIngress = new Readable({ read() {} });

    // 🛡️ TRICK DeepgramSTT: We map the raw WebSocket buffer to mimic a LiveKit AudioFrame
    // This means you don't have to change a single line of code in DeepgramSTT.ts!
    async function* wrapAudioStream(stream: Readable) {
      for await (const chunk of stream) {
        yield { data: chunk };
      }
    }

    // Start the continuous STT listener
    sttEngine.startListening(wrapAudioStream(audioIngress));

    // When the browser sends us audio, push it into the stream!
    ws.on("message", (message) => {
      if (Buffer.isBuffer(message)) {
        audioIngress.push(message);
      }
    });

    ws.on("close", () => {
      console.log("❌ User disconnected.");
      audioIngress.push(null); // End the microphone stream
      sttEngine.removeAllListeners();
    });

    // ==========================================
    // LLM & TTS EGRESS (Deepgram -> LLM -> TTS)
    // ==========================================
    let isProcessingTurn = false;

    sttEngine.on("transcriptReady", async (userTranscript: string) => {
      if (isProcessingTurn) return;
      isProcessingTurn = true;

      process.stdout.write("🤖 Aero says: "); 

      try {
        conversationHistory.push({ role: "user", content: userTranscript });

        let fullLLMResponse = "";

        async function* captureTokens(tokenStream: AsyncIterable<string>) {
          for await (const token of tokenStream) {
            fullLLMResponse += token;
            yield token; 
          }
        }

        const rawTokens = llmEngine.generate(conversationHistory);
        const interceptedTokens = captureTokens(rawTokens);
        const cleanSentences = chunkTextStream(interceptedTokens);
        const audioChunks = ttsEngine.synthesize(cleanSentences);

        // 🛡️ THE NEW SINK: Instead of pushing to LiveKit, we push directly to the WebSocket
        const websocketSink = new Writable({
          async write(chunk, encoding, callback) {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(chunk); // Send raw audio straight to the browser!
              }
              callback();
            } catch (err: any) {
              callback(err);
            }
          },
        });

        // Execute the pipeline
        await streamPipeline(Readable.from(audioChunks), websocketSink);

        console.log("\n");

        if (fullLLMResponse.trim().length > 0) {
          conversationHistory.push({
            role: "assistant",
            content: fullLLMResponse.trim(),
          });
        }
      } catch (error) {
        console.error("Pipeline Error:", error);
      } finally {
        console.log("\n👂 Ear is active. Waiting for you to speak...");
        isProcessingTurn = false;
      }
    });
  });
}