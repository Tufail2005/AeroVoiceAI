"use client";
import dynamic from "next/dynamic";

// Dynamically load the client component, strictly disabling Server-Side Rendering
const VoiceClientDynamic = dynamic(() => import("@/components/VoiceClient"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white font-mono">
      Booting WebRTC...
    </div>
  ),
});

export default function Home() {
  return (
    <main>
      <VoiceClientDynamic />
    </main>
  );
}
