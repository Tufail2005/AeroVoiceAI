import OpenAI from "openai";
import { type LLMEngine, type Message } from "../AgentRouter.js";

export class LocalLlamaLLM implements LLMEngine {
  // Point the SDK to local llama-server instance
  private client = new OpenAI({
    apiKey: "not-needed-for-local",
    baseURL: "http://127.0.0.1:8080/v1", // Default llama.cpp server port
  });

  async *generate(history: Message[]): AsyncIterable<string> {
    console.log("🧠 Local Brain computing...");

    try {
      const stream = await this.client.chat.completions.create({
        model: "local-model", // Name doesn't matter for llama-server
        messages: history,
        stream: true,
        temperature: 0.4, // Lower temp for the smaller 1.7B model to prevent hallucinations
        max_tokens: 150,
      });

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || "";
        if (token) {
          yield token;
        }
      }
    } catch (error) {
      console.error(
        "❌ Local LLM Error. Is llama-server running on port 8080?",
        error
      );
      throw error;
    }
  }
}
