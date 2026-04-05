import asyncio
import json
import numpy as np
import scipy.signal
from fastapi import FastAPI, WebSocket
from faster_whisper import WhisperModel
import io

app = FastAPI()

print("🚀 Loading Faster-Whisper (base.en) into VRAM...")
# Run on GPU, using FP16 to keep the VRAM footprint under 1GB
model = WhisperModel("small.en", device="cuda", compute_type="float16")
print("✅ Model loaded successfully.")

@app.websocket("/listen")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Buffer to hold incoming raw PCM bytes
    audio_buffer = bytearray()
    
    # We expect 48kHz audio from LiveKit (as defined in your orchestrator)
    # We need to collect enough frames to make a solid prediction.
    # 48000 samples/sec * 2 bytes/sample = 96000 bytes/sec
    BYTES_PER_SECOND = 96000
    CHUNK_SIZE = BYTES_PER_SECOND * 2 # Process in 2-second chunks for accuracy

    try:
        while True:
            # Receive the raw PCM buffer from Node.js
            data = await websocket.receive_bytes()
            audio_buffer.extend(data)

            # If we have enough audio, process it
            if len(audio_buffer) >= CHUNK_SIZE:
                # Convert the raw bytes to a numpy array of 16-bit integers
                audio_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
                
                # Faster-Whisper expects audio to be at 16000Hz. 
                # Note: In a production app, you'd use torchaudio or librosa to resample 
                # the 48kHz LiveKit audio down to 16kHz here before passing to transcribe()
                audio_16k = scipy.signal.decimate(audio_np, 3)
                
                # Transcribe the audio chunk
                segments, info = model.transcribe(
                    audio_16k, 
                    beam_size=1,        # Keep low for speed
                    language="en", 
                    vad_filter=True,    # Crucial: Automatically ignores silence
                    vad_parameters=dict(min_silence_duration_ms=500)
                )

                full_text = "".join([segment.text for segment in segments]).strip()

                if full_text:
                    # Send the completed transcript back to the Node Orchestrator
                    await websocket.send_text(json.dumps({
                        "type": "UtteranceEnd",
                        "text": full_text
                    }))

                # Clear the buffer for the next time the user speaks
                audio_buffer.clear()

    except Exception as e:
        print(f"WebSocket closed or error: {e}")