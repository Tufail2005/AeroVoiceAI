import { parentPort } from "worker_threads";
import { pipeline } from "@xenova/transformers";
import * as fs from "fs";
const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
const { cosineSimilarity } = await import(`./VectorMath${ext}`);

// The Worker's isolated memory
let embedder: any = null;
let vectorCache: any[] = [];

// Initialize the model and cache inside the worker
async function initWorker() {
  console.log("🧵 [Worker] Initializing Diet RAG on separate CPU core...");

  const filePath = new URL("../../local_vectors.json", import.meta.url);
  vectorCache = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("🧵 [Worker] RAG Models loaded and ready.");

  // Tell the main thread we are ready
  parentPort?.postMessage({ status: "ready" });
}

// Listen for text coming from the Main Thread
parentPort?.on("message", async (message) => {
  if (message.type === "QUERY") {
    try {
      const userTranscript = message.text;

      // Heavy vector math happens here, safely isolated from WebRTC!
      const queryOutput = await embedder(userTranscript, {
        pooling: "mean",
        normalize: true,
      });
      const queryVector = Array.from(queryOutput.data);

      let bestChunk = "";
      let highestScore = -1;

      for (const item of vectorCache) {
        const score = cosineSimilarity(
          queryVector as any,
          item.embedding as number[]
        );
        if (score > highestScore) {
          highestScore = score;
          bestChunk = item.text;
        }
      }

      // Send the result back to the main thread
      parentPort?.postMessage({
        type: "RESULT",
        bestChunk,
        highestScore,
      });
    } catch (error) {
      console.error("🧵 [Worker] Error:", error);
      parentPort?.postMessage({ type: "ERROR", error });
    }
  }
});

initWorker();
