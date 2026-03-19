// Import the Express framework to create our web server
import express from "express";
// Import the AccessToken class from LiveKit's server SDK to handle token generation
import { AccessToken } from "livekit-server-sdk";
// Import dotenv to load secure environment variables from a .env file
import dotenv from "dotenv";
// Import CORS middleware to allow our frontend application to communicate with this backend
import cors from "cors";

// Parse the .env file and load the variables into process.env
dotenv.config();

// Initialize the Express application instance
const app = express();
// Apply the CORS middleware to all routes so the browser doesn't block requests
app.use(cors());

// Define a GET route at the URL path "/api/token"
app.get("/api/token", async (req, res) => {
  // Generate a random username, like "user-482"
  const participantName = `user-${Math.floor(Math.random() * 1000)}`;
  // Set a hardcoded room name that everyone hitting this endpoint will join
  const roomName = "aerovoice-room";

  // Initialize a new LiveKit access token object using credentials from the .env file
  // and assign the random username as this token's identity
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

// Start the Express server and have it listen for incoming traffic on port 3001
app.listen(3001, () => console.log("Token server running on port 3001"));
