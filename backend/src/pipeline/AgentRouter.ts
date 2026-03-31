// Standardizing the Context

import { DeepgramSTT } from "./cloudEngines/DeepgramSTT.js";
import { GroqLLM } from "./cloudEngines/GroqLLM.js";
import { ElevenLabsTTS } from "./cloudEngines/ElevenLabTTS.js";

import { LocalWhisperSTT } from "./LocalEngines/localSTT.js";
import { LocalLlamaLLM } from "./LocalEngines/localLLM.js";
import { LocalKokoroTTS } from "./LocalEngines/localTTS.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// The Ear (Speech-To-Text)
// Must accept raw PCM audio frames from LiveKit and return a finalized text transcript.
export interface STTEngine {
  startListening(audioStream: AsyncIterable<any>): void;
  on(event: string, listener: (...args: any[]) => void): this;
}

// The Brain (Language Model)
// MUST return an AsyncIterable. We cannot wait for the full response to generate.
export interface LLMEngine {
  generate(history: Message[]): AsyncIterable<string>;
}

// The Voice (Text-To-Speech)
// Must accept an incoming stream of text (the chunked sentences)
// and yield an outgoing stream of raw PCM Audio Buffers for LiveKit.
export interface TTSEngine {
  synthesize(textStream: AsyncIterable<string>): AsyncIterable<Buffer>;
}

// The Strategy Context
// A wrapper that holds one of our specific engine configurations (Cloud vs Local)
export interface AIEnginePipeline {
  stt: STTEngine;
  llm: LLMEngine;
  tts: TTSEngine;
}

// THE ROUTER: Decides which engines to load at startup
export function buildAIPipeline(): AIEnginePipeline {
  const mode = process.env.ENGINE_MODE || "CLOUD";

  if (mode === "LOCAL") {
    console.log("🏎️ Booting in LOCAL Mode (The 4GB Ferrari Pipeline)");
    return {
      stt: new LocalWhisperSTT(),
      llm: new LocalLlamaLLM(),
      tts: new LocalKokoroTTS(),
    };
  }

  console.log("☁️ Booting in CLOUD Mode (The Honda Civic Pipeline)");
  return {
    stt: new DeepgramSTT(),
    llm: new GroqLLM(),
    tts: new ElevenLabsTTS(),
  };
}
