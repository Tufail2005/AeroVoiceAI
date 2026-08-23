"use client";

import { useEffect, useState, useRef } from "react";

function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  if (isConnected) {
    return (
      <p className="animate-pulse text-green-400 mb-8 font-mono text-lg">
        ● Connected & Listening...
      </p>
    );
  }
  return (
    <p className="animate-pulse text-yellow-400 mb-8 font-mono text-lg">
      ● Negotiating connection...
    </p>
  );
}

export default function VoiceClient() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const connect = async () => {
    setIsConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 48000 });
      audioContextRef.current = audioCtx;
      nextPlayTimeRef.current = audioCtx.currentTime;

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const wsUrl = backendUrl.replace(/^http/, "ws");
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        console.log("✅ WebSocket Connected!");

        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        gainNodeRef.current = gainNode;

        processor.onaudioprocess = (e) => {
          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
          if (isMuted) return;

          const inputData = e.inputBuffer.getChannelData(0);
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          socketRef.current.send(int16Data.buffer);
        };

        source.connect(processor);
        processor.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      };

      socket.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          playRawPCMChunk(arrayBuffer);
        }
      };

      socket.onclose = () => {
        disconnect();
      };

    } catch (err) {
      console.error("Connection failed:", err);
      setIsConnecting(false);
    }
  };

  // 🛡️ FIXED: Parse raw PCM linear16 bytes directly into an AudioBuffer
  const playRawPCMChunk = (arrayBuffer: ArrayBuffer) => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx || audioCtx.state === "closed") return;

    try {
      const int16Data = new Int16Array(arrayBuffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0; // Normalize to -1.0 -> 1.0
      }

      // Deepgram TTS default output sample rate is 24000Hz. 
      // Web Audio API automatically resamples this to match your 48000Hz context.
      const sampleRate = 24000;
      const audioBuffer = audioCtx.createBuffer(1, float32Data.length, sampleRate);
      audioBuffer.copyToChannel(float32Data, 0);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const currentTime = audioCtx.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime;
      }

      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    } catch (error) {
      console.error("Error playing raw PCM chunk:", error);
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const disconnect = () => {
    setIsConnecting(false);
    setIsConnected(false);

    if (processorRef.current) {
      processorRef.current.disconnect();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
  };

  useEffect(() => {
    return () => disconnect();
  }, []);

  if (!isConnecting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white font-mono">
        <div className="bg-gray-900 p-10 rounded-2xl shadow-2xl border border-gray-800 flex flex-col items-center">
          <h1 className="text-4xl font-bold mb-2 bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            AeroVoiceAI
          </h1>
          <p className="text-gray-400 mb-8 font-sans">
            Ready to connect directly to the Orchestrator.
          </p>
          <button
            onClick={connect}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(37,99,235,0.5)] hover:shadow-[0_0_25px_rgba(37,99,235,0.7)] hover:scale-105"
          >
            Connect & Allow Mic
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white">
      <h1 className="text-3xl font-bold mb-2">AeroVoiceAI Edge Layer</h1>

      <ConnectionStatus isConnected={isConnected} />

      <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 p-4 rounded-2xl shadow-xl flex gap-4 mt-4">
        <button
          onClick={toggleMute}
          className={`px-6 py-2 rounded-lg font-bold transition-colors ${
            isMuted ? "bg-yellow-600 hover:bg-yellow-500" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>

        <button
          onClick={disconnect}
          className="px-6 py-2 rounded-lg font-bold bg-red-600 hover:bg-red-700 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}