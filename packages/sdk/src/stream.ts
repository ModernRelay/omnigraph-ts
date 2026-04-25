import { snakeToCamel } from './case';

export async function* ndjsonIterator<T = unknown>(
  response: Response,
): AsyncIterable<T> {
  if (!response.body) {
    throw new Error('Response has no body to stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        yield snakeToCamel<T>(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    const final = buffer.trim();
    if (final.length > 0) {
      yield snakeToCamel<T>(JSON.parse(final));
    }
  } finally {
    reader.releaseLock();
  }
}
