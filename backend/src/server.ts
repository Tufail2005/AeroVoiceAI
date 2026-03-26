import express from "express";

import { AccessToken } from "livekit-server-sdk"; // Import to handle token generation
import dotenv from "dotenv";
import cors from "cors";

dotenv.config(); // Parse the .env file

const app = express();
app.use(cors());

app.get("/api/token", async (req, res) => {
  // Generate a random username, like "user-482"
  const participantName = `user-${Math.floor(Math.random() * 1000)}`;
  // Set a hardcoded room name that everyone hitting this endpoint will join
  const roomName = "aerovoice-room";

  // Initialize a new LiveKit access token object using credentials from the .env file
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: participantName }
  );

  // Define the exact permissions tied to this specific token
  at.addGrant({
    roomJoin: true, // Permission to join a room
    room: roomName, // The specific room they are allowed to join
    canPublish: true, // Permission to send their own microphone/camera data
    canSubscribe: true, // Permission to hear/see other people in the room
  });

  const jwtToken = await at.toJwt();
  // Convert the configured token object into a signed JWT string and send it to the client as JSON
  res.json({ token: jwtToken });
});

app.listen(3001, () => console.log("Token server running on port 3001"));
