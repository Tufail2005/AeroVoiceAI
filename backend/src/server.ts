import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import cors from "cors";
import { startOrchestrator } from "./orchestrator.js"; 

dotenv.config();

const app = express();
app.use(cors());

// A simple ping endpoint to keep the server awake
app.get("/api/health", (req, res) => {
  res.status(200).send("Server is awake!");
});

// 1. Create a raw HTTP server from the Express app
const server = createServer(app);

// 2. Attach the WebSocket server to it
const wss = new WebSocketServer({ server });

// 3. Hand the WebSocket server over to your Orchestrator
startOrchestrator(wss);

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`🚀 Server & WebSocket running on port ${port}`));