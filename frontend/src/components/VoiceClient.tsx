"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
} from "@livekit/components-react";
import { KrispManager } from "./KrispManager";
import "@livekit/components-styles";

export default function VoiceClient() {
  const [token, setToken] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const resp = await fetch("http://localhost:3001/api/token");
        const data = await resp.json();
        console.log("📦 Raw API Response:", data);

        if (typeof data.token === "string") {
          setToken(data.token);
        } else if (typeof data === "string") {
          setToken(data);
        } else {
          console.error("❌ Failed to extract token string from:", data);
        }
      } catch (e) {
        console.error("Failed to fetch token", e);
      }
    };
    fetchToken();
  }, []);

  //  Loading State
  if (token === "") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white font-mono">
        Initializing Edge Layer...
      </div>
    );
  }

  // The Pre-Join Screen
  if (!isConnecting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white font-mono">
        <h1 className="text-3xl font-bold mb-4">AeroVoiceAI Edge Layer</h1>
        <p className="text-gray-400 mb-8">
          Ready to connect to the Orchestrator.
        </p>
        <button
          onClick={() => setIsConnecting(true)}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-all"
        >
          Click to Connect & Allow Mic
        </button>
      </div>
    );
  }

  // The Active Room
  return (
    <LiveKitRoom
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      token={token}
      connect={true}
      audio={true}
    >
      <KrispManager />
      <RoomAudioRenderer />

      <div className="p-10 flex flex-col items-center justify-center h-screen bg-gray-950 text-white">
        <h1 className="text-3xl font-bold mb-4">AeroVoiceAI Edge Layer</h1>
        <p className="animate-pulse text-green-400 mb-8">
          Connected & Listening...
        </p>

        <ControlBar />
      </div>
    </LiveKitRoom>
  );
}
