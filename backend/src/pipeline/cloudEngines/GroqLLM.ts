import OpenAI from "openai";
import { type LLMEngine, type Message } from "../AgentRouter.js";
import dotenv from "dotenv";

dotenv.config();

export class GroqLLM implements LLMEngine {
  // Configure the OpenAI SDK to point to Groq's endpoints
  private client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });

  // The async generator forces streaming behavior
  async *generate(history: Message[]): AsyncIterable<string> {
    console.log("🧠 Brain thinking...");

    const stream = await this.client.chat.completions.create({
      model: "llama-3.1-8b-instant", // Groq's identifier for Llama 3 8B
      messages: history,
      stream: true, // This must be true for low latency!
      temperature: 0.5, // Keep it relatively deterministic
      max_tokens: 256, // Keep responses short and conversational
    });

    for await (const chunk of stream) {
      // Safely extract the token from the stream chunk
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        // Yield pushes the token down the pipeline instantly
        yield token;
      }
    }
  }
}
