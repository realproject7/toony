// Split a streamed NDJSON body into parsed lines. Chunks may end mid-line or
// mid-character; the decoder keeps the remainder until the next chunk.

export interface LineDecoder {
  push: (chunk: Uint8Array) => void;
  /** Flush a final line without a trailing newline. */
  end: () => void;
}

export function createLineDecoder(onValue: (value: unknown) => void): LineDecoder {
  const decoder = new TextDecoder();
  let pending = "";
  const emit = (line: string): void => {
    const text = line.trim();
    if (text === "") return;
    try {
      onValue(JSON.parse(text));
    } catch {
      // A malformed line is skipped; the stream continues.
    }
  };
  return {
    push(chunk) {
      pending += decoder.decode(chunk, { stream: true });
      let index = pending.indexOf("\n");
      while (index !== -1) {
        emit(pending.slice(0, index));
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
      }
    },
    end() {
      pending += decoder.decode();
      emit(pending);
      pending = "";
    },
  };
}
