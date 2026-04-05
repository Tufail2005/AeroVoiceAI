"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  TrackToggle,
  DisconnectButton,
  useConnectionState,
} from "@livekit/components-react";
import { KrispManager } from "./KrispManager";
import "@livekit/components-styles";
import { Track } from "livekit-client";

// A small sub-component to handle the exact connection status text
function ConnectionStatus() {
  const connectionState = useConnectionState();

  if (connectionState === "connected") {
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
  const [token, setToken] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
        const resp = await fetch(`${backendUrl}/api/token`);

        if (!resp.ok) throw new Error("Failed to reach backend");

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

  // --- Loading State (With Cold Start Warning) ---
  if (token === "") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white font-mono p-6 text-center">
        <h2 className="text-2xl font-bold mb-4 animate-pulse">
          Waking up the AI...
        </h2>

        {fetchError ? (
          <div className="bg-red-900/50 border border-red-500 p-4 rounded max-w-md mt-4 text-red-200">
            <p className="font-bold">Connection Failed</p>
            <p className="text-sm mt-1">
              Could not reach the backend server. Please check your Render
              deployment.
            </p>
          </div>
        ) : (
          <div className="bg-yellow-900/30 border border-yellow-600/50 p-5 rounded-lg max-w-md mt-4 text-yellow-200 shadow-lg">
            <p className="font-bold text-yellow-400 mb-2">
              ⚠️ Cold Start Notice
            </p>
            <p className="text-sm opacity-90 leading-relaxed">
              This demo runs on a free cloud tier. If the app hasn't been used
              in the last 15 minutes, the backend spins down.{" "}
              <strong>It may take up to 50 seconds</strong> to establish the
              initial connection. Please be patient!
            </p>
          </div>
        )}
      </div>
    );
  }

  // --- The Pre-Join Screen ---
  if (!isConnecting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white font-mono">
        <div className="bg-gray-900 p-10 rounded-2xl shadow-2xl border border-gray-800 flex flex-col items-center">
          <h1 className="text-4xl font-bold mb-2 bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            AeroVoiceAI
          </h1>
          <p className="text-gray-400 mb-8 font-sans">
            Ready to connect to the Orchestrator.
          </p>
          <button
            onClick={() => setIsConnecting(true)}
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
    <LiveKitRoom
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      token={token}
      connect={true}
      audio={true}
      // Disconnect cleanly if they close the tab
      options={{ publishDefaults: { stopMicTrackOnMute: true } }}
    >
      <KrispManager />
      <RoomAudioRenderer />

      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white">
        <h1 className="text-3xl font-bold mb-2">AeroVoiceAI Edge Layer</h1>

        <ConnectionStatus />

        {/* Custom Audio-Only Control Bar */}
        <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 p-4 rounded-2xl shadow-xl flex gap-4 mt-4">
          <TrackToggle
            source={Track.Source.Microphone}
            className="lk-button" // Uses LiveKit default styling
          />
          <DisconnectButton
            className="lk-button bg-red-600 hover:bg-red-700 transition-colors"
            onClick={() => setIsConnecting(false)} // Reset UI on leave
          >
            Disconnect
          </DisconnectButton>
        </div>
      </div>
    </LiveKitRoom>
  );
}
