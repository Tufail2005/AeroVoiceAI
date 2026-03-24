export async function* chunkTextStream(
  tokenStream: AsyncIterable<string>
): AsyncIterable<string> {
  let buffer = "";
  let isFirstChunk = true;
  // We split only on ending punctuation followed by a space, or a newline.
  // We explicitly DO NOT split on commas.
  const firstChunkRegex = /([.,?!-])\s+|\n+/g;
  const sentenceRegex = /([.?!])\s+|\n+/g;

  for await (const token of tokenStream) {
    buffer += token;

    const currentRegex = isFirstChunk ? firstChunkRegex : sentenceRegex;
    let match;

    while ((match = currentRegex.exec(buffer)) !== null) {
      const splitIndex = match.index + match[0].length;
      const sentence = buffer.slice(0, splitIndex).trim();

      // Enforce a minimum length so we don't send microscopic chunks like "Yes."
      // which gives ElevenLabs no context for emotion.
      const minLength = isFirstChunk ? 5 : 15;

      if (sentence.length > minLength) {
        yield sentence;
        // Keep the remainder of the buffer for the next sentence
        buffer = buffer.slice(splitIndex);
        sentenceRegex.lastIndex = 0;
      }
    }
  }

  // If there's any leftover text when Groq finishes generating, yield it.
  if (buffer.trim().length > 0) {
    yield buffer.trim();
  }
}
