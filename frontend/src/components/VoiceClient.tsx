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

  // References to hold our native browser APIs
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Connect directly to the WebSocket and Microphone
  const connect = async () => {
    setIsConnecting(true);

    try {
      // 1. Get the microphone stream with native echo cancellation!
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 2. Set up AudioContext for playing AI responses
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      nextPlayTimeRef.current = audioContextRef.current.currentTime;

      // 3. Connect WebSocket to Render backend
      // Automatically swaps http:// for ws:// or https:// for wss://
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const wsUrl = backendUrl.replace(/^http/, "ws");
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        console.log("✅ WebSocket Connected to Render!");

        // 4. Start recording and sending audio chunks every 250ms
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };

        mediaRecorder.start(250);
      };

      socket.onmessage = async (event) => {
        // 5. Receive Audio from AI and play it instantly
        if (event.data instanceof Blob) {
          const arrayBuffer = await event.data.arrayBuffer();
          playAudioChunk(arrayBuffer);
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

  // A queuing system to make sure the AI sentences play seamlessly in order
  const playAudioChunk = async (arrayBuffer: ArrayBuffer) => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx) return;

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      // Schedule audio to play sequentially without overlapping
      const currentTime = audioCtx.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime;
      }

      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    } catch (error) {
      console.error("Error decoding AI audio:", error);
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const disconnect = () => {
    setIsConnecting(false);
    setIsConnected(false);

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  };

  // Cleanup to prevent ghost connections on unmount
  useEffect(() => {
    return () => disconnect();
  }, []);

  // --- The Pre-Join Screen ---
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

  // --- The Active Room ---
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white">
      <h1 className="text-3xl font-bold mb-2">AeroVoiceAI Edge Layer</h1>

      <ConnectionStatus isConnected={isConnected} />

      {/* Custom Audio-Only Control Bar */}
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