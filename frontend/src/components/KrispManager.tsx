"use client";

import { useEffect } from "react";
import { useKrispNoiseFilter } from "@livekit/components-react/krisp";

export function KrispManager() {
  const krisp = useKrispNoiseFilter();

  useEffect(() => {
    if (!krisp.isNoiseFilterEnabled && !krisp.isNoiseFilterPending) {
      krisp
        .setNoiseFilterEnabled(true)
        .then(() => console.log("🎧 Client-side Krisp Noise Filter activated!"))
        .catch(console.error);
    }
  }, [krisp]);

  return null;
}
