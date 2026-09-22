/**
 * The OpenAI streaming chat-completion wire format, built by hand.
 * No SDK: we are the server, and the whole point of this route is that nothing
 * in it can rewrite the text.
 */
function frame(body: unknown): string {
  return `data: ${JSON.stringify(body)}\n\n`;
}

function chunk(id: string, created: number, model: string, delta: unknown, finish: string | null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/**
 * Emits the user's text unmodified. The text is sent as ONE content frame:
 * splitting it would only add latency, and there is no model to stream from.
 */
export function buildVerbatimSSE(
  text: string,
  model: string,
  id: string,
  createdSeconds: number,
): string[] {
  const frames = [frame(chunk(id, createdSeconds, model, { role: "assistant", content: "" }, null))];
  if (text.length > 0) {
    frames.push(frame(chunk(id, createdSeconds, model, { content: text }, null)));
  }
  frames.push(frame(chunk(id, createdSeconds, model, {}, "stop")));
  frames.push("data: [DONE]\n\n");
  return frames;
}
