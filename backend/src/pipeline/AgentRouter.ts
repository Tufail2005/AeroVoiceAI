// Standardizing the Context
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// The Ear (Speech-To-Text)
// Must accept raw PCM audio frames from LiveKit and return a finalized text transcript.
export interface STTEngine {
  // Note: We will eventually use WebSockets for real-time STT, 
  // but the interface simply promises to return the spoken string.
  transcribe(audioStream: AsyncIterable<any>): Promise<string>;
}

// The Brain (Language Model)
// MUST return an AsyncIterable. We cannot wait for the full response to generate.
// We must stream tokens as they arrive to keep latency near zero.
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