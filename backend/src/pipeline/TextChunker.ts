export async function* chunkTextStream(
  tokenStream: AsyncIterable<string>
): AsyncIterable<string> {
  let buffer = "";
  // We split only on ending punctuation followed by a space, or a newline.
  // We explicitly DO NOT split on commas.
  const sentenceRegex = /([.?!])\s+|\n+/g;

  for await (const token of tokenStream) {
    buffer += token;

    let match;

    while ((match = sentenceRegex.exec(buffer)) !== null) {
      const splitIndex = match.index + match[0].length;
      const sentence = buffer.slice(0, splitIndex).trim();

      // Enforce a minimum length so we don't send microscopic chunks like "Yes."
      // which gives ElevenLabs no context for emotion.
      if (sentence.length > 15) {
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
