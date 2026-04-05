# 🎙️ AeroVoiceAI

> ⚡ **Real-Time Conversational AI Agent**  
> Hybrid Cloud + Local (4GB VRAM) architecture with agentic RAG capabilities.

---

## ✨ Overview

AeroVoiceAI is a high-performance conversational AI system built with a **Dual-Engine Architecture**:

- ☁️ **Cloud Engine** → Highly available, production-ready
- 🏎️ **Local Engine** → Fully offline, GPU-optimized fallback

> The frontend remains completely unaware of which engine is active — seamless switching via `ENGINE_MODE`.

---

## 🏗️ Architecture

### 🔁 Dual-Engine Strategy

| Layer | ☁️ Cloud Engine ("Honda Civic") | 🏎️ Local Engine ("Ferrari") |
|-------|--------------------------------|-----------------------------|
| **Transport** | LiveKit Cloud (WebRTC) | Local LiveKit (Docker CPU) |
| **STT (Ear)** | Deepgram Nova-3 | Faster-Whisper `base.en` |
| **LLM (Brain)** | Groq (Llama-3-8B) | Qwen-3-1.7B (`llama.cpp`) |
| **TTS (Voice)** | ElevenLabs Turbo v2.5 | Kokoro TTS |
| **Memory (RAG)** | Transformers.js (CPU Worker) | Transformers.js (CPU Worker) |

---

## 🧠 Engineering Highlights

### 🚀 Performance & System Design

- **Hybrid Transport + Edge VAD**
  - WebRTC handled in cloud via LiveKit
  - Noise cancellation runs in-browser (WASM)

- **"Diet RAG" Worker Thread**
  - Offloads embeddings + cosine similarity
  - Prevents blocking Node.js event loop

- **Audio Decimation Pipeline**
  - `48kHz → 16kHz` using `scipy.signal.decimate`
  - Eliminates STT hallucinations

- **Streaming Token Interceptor ("Water Meter")**
  - Captures LLM output during streaming
  - Prevents context poisoning loops

---

## 🚀 Getting Started

### ☁️ Cloud Engine (Production Mode)

#### 🔧 Backend Setup

```bash
cd backend
npm install
```

Create `.env`:

```env
ENGINE_MODE=CLOUD
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-project.livekit.cloud

DEEPGRAM_API_KEY=your_key
GROQ_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
```

Run:

```bash
npm run dev
```

#### 🎨 Frontend Setup

```bash
cd frontend
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

Run:

```bash
npm run dev
```

👉 Open: `http://localhost:3000`

---

### 🏎️ Local Engine (Offline Mode)

> ⚠️ Requires 4 terminals

#### 1️⃣ Start Infrastructure (CPU)

```bash
cd backend
docker compose up -d
```

#### 2️⃣ Start LLM (GPU)

```bash
cd models
.\llama-server.exe -m qwen-3-1.7b.Q4_K_M.gguf -ngl 99 -c 2048 --port 8080
```

#### 3️⃣ Start STT (GPU)

```bash
cd python-backend

python -m venv venv
.\venv\Scripts\activate

pip install fastapi uvicorn websockets faster-whisper numpy

uvicorn whisper_server:app --port 8000
```

#### 4️⃣ Configure Backend

```env
ENGINE_MODE=LOCAL
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://127.0.0.1:7880
```

#### 5️⃣ Update Frontend

```env
NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

#### ▶️ Start App

Same as cloud:

```bash
npm run dev
```

---

## 🗺️ Future Work & Roadmap 

- [ ] **True Barge-in (Interruptions)**
  - AbortController-based LLM stream cancel
  - Instant voice interruption handling

- [ ] **Live Terminal UI**
  - Stream tokens via LiveKit Data Channels
  - Real-time debugging + transparency

- [ ] **Agentic Tool Calling**
  - Function calling (DB, APIs, calendar)

- [ ] **Dynamic Endpointing**
  - Context-aware VAD silence thresholds

---

## 🧩 Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js, WebRTC |
| **Backend** | Node.js, TypeScript |
| **Streaming** | LiveKit |
| **LLM** | Groq / llama.cpp |
| **STT** | Deepgram / Faster-Whisper |
| **TTS** | ElevenLabs / Kokoro |
| **RAG** | Transformers.js |

---

## ⚡ Key Idea

> Decouple real-time transport from AI processing pipelines  
> → Achieve **low latency** + **high reliability** + **offline fallback**

---

## 📌 Notes

- Designed for real-time voice agents
- Optimized for low VRAM environments (4GB GPU)
- Built with production + demo modes in mind
