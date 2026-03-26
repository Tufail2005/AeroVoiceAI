// backend/scripts/ingest.ts
import { pipeline } from "@xenova/transformers";
import fs from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
const pdfParse = require("pdf-parse");

const prisma = new PrismaClient({} as any);

async function runIngestion() {
  console.log("🚀 Starting Document Ingestion Pipeline...");

  //  Load the local embedding model
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  //  Parse the PDF
  const dataBuffer = fs.readFileSync("./knowledge_base.pdf"); // Put your 100-page PDF here
  const pdfData = await pdfParse(dataBuffer);

  //  Robust Chunking Strategy for large PDFs (approx. 500 chars per chunk)
  const rawText = pdfData.text.replace(/\n/g, " "); // Strip weird PDF line breaks
  const chunks = rawText.match(/.{1,500}(?=\s|$)/g) || [];

  console.log(`📄 Splitting PDF into ${chunks.length} distinct text chunks...`);

  const memoryCache = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i].trim();
    if (chunk.length < 50) continue; // Skip microscopic useless chunks

    process.stdout.write(`\r Embedding chunk ${i + 1}/${chunks.length}`);

    //  Generate the 384-dimensional vector locally
    const output = await extractor(chunk, { pooling: "mean", normalize: true });
    const embeddingArray = Array.from(output.data);

    // Save to the in-memory array cache
    memoryCache.push({
      text: chunk,
      embedding: embeddingArray,
    });

    //  Push to Neon Postgres via Prisma raw query
    // (Prisma requires raw queries for vector insertions)
    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk" (id, text, embedding) 
      VALUES (gen_random_uuid(), ${chunk}, ${embeddingArray}::vector)
    `;
  }

  //  Save the cache for zero-latency local lookups
  fs.writeFileSync(
    "./local_vectors.json",
    JSON.stringify(memoryCache, null, 2)
  );

  console.log(
    "\n✅ Ingestion Complete! Vectors synced to Neon and local JSON."
  );
  await prisma.$disconnect();
}

runIngestion().catch(console.error);
