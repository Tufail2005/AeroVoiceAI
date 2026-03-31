import { pipeline } from "@xenova/transformers";
import * as fs from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { extractText } from "unpdf";
import "dotenv/config";
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function runIngestion() {
  console.log("🚀 Starting Document Ingestion Pipeline...");

  // Load the local embedding model
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  // Parse the 100-page PDF using the modern unpdf engine
  console.log("📄 Reading PDF...");
  const pdfBuffer = fs.readFileSync("./knowledge_base.pdf");

  // Convert the Node Buffer to a standard Uint8Array
  const pdfUint8Array = new Uint8Array(pdfBuffer);
  const { text: rawText } = await extractText(pdfUint8Array);

  // Robust Chunking: Clean up line breaks and split into ~500 character chunks
  const cleanText = rawText.join("").replace(/\n/g, " ").replace(/\s+/g, " ");
  // This regex grabs chunks of up to 500 chars, breaking cleanly at spaces
  const chunks = cleanText.match(/.{1,500}(?=\s|$)/g) || [];

  console.log(
    `✂️ Split PDF into ${chunks.length} text chunks. Generating embeddings...`
  );

  const memoryCache = [];

  // Process embeddings
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!.trim();
    if (chunk.length < 50) continue; // Skip microscopic/empty chunks

    process.stdout.write(`\r⚙️ Embedding chunk ${i + 1}/${chunks.length}`);

    // Generate the 384-dimensional vector locally
    const output = await extractor(chunk, { pooling: "mean", normalize: true });
    const embeddingArray = Array.from(output.data);

    // Save to the in-memory array cache
    memoryCache.push({ text: chunk, embedding: embeddingArray });

    const vectorString = `[${embeddingArray.join(",")}]`;

    // Push to Neon Postgres via Prisma raw query (required for pgvector)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk" (id, text, embedding) 
       VALUES (gen_random_uuid(), $1, '${vectorString}'::vector)`,
      chunk
    );
    // await prisma.$executeRaw`
    //   INSERT INTO "DocumentChunk" (id, text, embedding)
    //   VALUES (gen_random_uuid(), ${chunk}, ${embeddingArray}::vector)
    // `;
  }

  // Save the cache for zero-latency local lookups
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
