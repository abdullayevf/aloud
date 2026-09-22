# Aloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed web app where a deaf user types, their words are spoken aloud on a live call **verbatim**, the other party is captioned live, every utterance carries a receipt proving it was not altered, and the provider's recording is deleted when the call ends.

**Architecture:** One Next.js app on Vercel. A stored AssemblyAI agent points its `llm` at *our own* OpenAI-compatible endpoint; in verbatim mode that endpoint runs no model and echoes the user's typed text, so the words cannot be paraphrased. The browser holds the WebSocket directly and streams base64 PCM16 at 24 kHz. All UI state is client-side. There is no database.

**Tech Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS · Vitest · Web Audio `AudioWorklet` · AssemblyAI Voice Agent API (stored agents, custom LLM, Sessions API).

**Spec:** [`docs/superpowers/specs/2026-09-22-aloud-design.md`](../specs/2026-09-22-aloud-design.md)
**Verified API reference:** [`docs/assemblyai-integration.md`](../../assemblyai-integration.md) §10
**Product requirements:** [`docs/PRD.md`](../../PRD.md)

## Global Constraints

Every task's requirements implicitly include this section. Exact values, copied from the spec and the API reference.

- **The API key never reaches the browser.** `ASSEMBLYAI_API_KEY` and `ALOUD_LLM_SHARED_SECRET` are read only inside `app/api/**`. Any `NEXT_PUBLIC_` variable holding either is a build failure.
- **Auth headers differ by host.** `Authorization: Bearer $ASSEMBLYAI_API_KEY` on `agents.assemblyai.com`. No `Bearer` prefix on `api.assemblyai.com`.
- **Token:** `GET https://agents.assemblyai.com/v1/token`. `expires_in_seconds` is **required**, 1–600; use `120`. `max_session_duration_seconds` = `600`. Tokens are **single-use** — mint a fresh one before every connect, **including every resume**. Never cache.
- **`llm` is a stored-agent field only.** It does not exist in the inline `session.update` schema. Aloud therefore always connects with `{"type":"session.update","session":{"agent_id":"<id>"}}` as the **first and only** config message. Sending `agent_id` together with any inline field raises `agent_id_not_first`.
- **`base_url` must be public HTTPS.** Private and loopback hosts are rejected. There is no localhost path for the custom LLM — deploy first, develop against the deployment.
- **Streaming is required** on `POST {base_url}/chat/completions`.
- **Audio:** PCM16 signed little-endian, mono, **24000 Hz**, base64 inside JSON. Send at real time; faster is dropped (`audio_rate_violation`). `input.audio` carries audio in `audio`; `reply.audio` carries it in **`data`**.
- **Never** `new AudioContext({ sampleRate: 24000 })`. Let the browser choose and resample inside the worklet. Forcing 24 kHz kills echo cancellation on Firefox and garbles audio on Safari.
- **`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })`** — exactly this.
- **`transcript.user.delta.text` is the full transcript so far.** Replace, never concatenate.
- **End sessions with `{"type":"session.end"}`**, wait for `session.ended`, then close. Never `{"type":"Terminate"}` (that is realtime STT). Closing bare leaves a **billable** 30-second resume window.
- **Do not send `input.audio` before `session.ready`.**
- **Do not set `input.turn_detection`.** Setting `min_silence`/`max_silence` disables adaptive pacing for the whole session.
- **Do not set `input.language_codes`.** Omission enables automatic detection and code-switching.
- **`greeting`, `output.voice` and `output.format` are immutable after `session.ready`.**
- **No model may ever touch verbatim text.** If a task tempts you to route typed text through an LLM "to tidy it", the product's central claim is void. Stop and re-read spec §3.4.
- **Voice IDs are exact strings** from the verified list. `jane` is the default here. Invented names are rejected with `invalid_value`.
- **Copy rule:** never write that a recording is "erased" or "destroyed". `DELETE /v1/sessions/{id}` is a documented **soft delete**; the UI says the recording was deleted and its artifacts are inaccessible, and nothing stronger.
- **Conventions:** every task ends with a commit. TDD wherever a pure function exists — write the failing test, run it, watch it fail, implement, watch it pass. Sockets, microphones and TTS are verified by hand.

---

## File structure

| Path | Responsibility |
|---|---|
| `lib/token.ts` | Builds the token-endpoint URL. Pure. |
| `lib/sentinel.ts` | The in-band mode + text protocol that travels through AssemblyAI. Pure. |
| `lib/openai-sse.ts` | Encodes OpenAI-shaped streaming chat-completion chunks. Pure. |
| `lib/agent-config.ts` | Builds the stored-agent payload. Pure. |
| `lib/ledger.ts` | The typed-vs-spoken reducer and its normalisation rules. Pure. |
| `lib/audio/pcm.ts` | PCM16 ↔ Float32 ↔ base64. Pure. |
| `lib/audio/capture.ts` | Microphone → worklet → base64 chunks. |
| `lib/audio/playback.ts` | `reply.audio` scheduling and barge-in flush. |
| `lib/relay-client.ts` | The WebSocket state machine. |
| `public/pcm-processor.js` | The AudioWorklet. Must be a URL, never bundled. |
| `app/api/call/route.ts` | Ensures the stored agent exists, mints a token. |
| `app/api/llm/v1/chat/completions/route.ts` | The pass-through AssemblyAI calls for every reply. |
| `app/api/end/route.ts` | `DELETE /v1/sessions/{id}`. |
| `app/page.tsx` | The one screen. |
| `app/components/*` | Caption pane, composer, ledger, status bar. |

---

### Task 1: Scaffold, the token route, and a public deployment

The custom LLM requires a public HTTPS `base_url`, so this project has no localhost-only phase. Deploy on day one.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`
- Modify: `.gitignore` — **it already exists and already covers `.env*`.** `create-next-app` will not overwrite it. Do not replace it with the generated one.
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `lib/token.ts`, `app/api/call/route.ts`
- Test: `lib/token.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TOKEN_EXPIRY_SECONDS: number`, `MAX_SESSION_SECONDS: number`, `buildTokenUrl(): URL` from `lib/token.ts`; `POST /api/call` responding `{ token: string }` or `{ error: string }`.

- [ ] **Step 1: Scaffold**

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Add the Vitest config and scripts**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Write the failing test**

```ts
// lib/token.test.ts
import { describe, expect, it } from "vitest";
import { buildTokenUrl } from "./token";

describe("buildTokenUrl", () => {
  it("targets the voice agent token endpoint", () => {
    const url = buildTokenUrl();
    expect(url.origin + url.pathname).toBe("https://agents.assemblyai.com/v1/token");
  });

  it("always sends expires_in_seconds, which the API requires", () => {
    const value = Number(buildTokenUrl().searchParams.get("expires_in_seconds"));
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(600);
  });

  it("caps the session so a leaked socket cannot bill for three hours", () => {
    expect(Number(buildTokenUrl().searchParams.get("max_session_duration_seconds"))).toBe(600);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm test -- lib/token.test.ts`
Expected: FAIL — `Failed to resolve import "./token"`.

- [ ] **Step 5: Implement**

```ts
// lib/token.ts
export const TOKEN_EXPIRY_SECONDS = 120;
export const MAX_SESSION_SECONDS = 600;

/** GET https://agents.assemblyai.com/v1/token — expires_in_seconds is REQUIRED (1..600). */
export function buildTokenUrl(): URL {
  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", String(TOKEN_EXPIRY_SECONDS));
  url.searchParams.set("max_session_duration_seconds", String(MAX_SESSION_SECONDS));
  return url;
}
```

- [ ] **Step 6: Run the test again**

Run: `npm test -- lib/token.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Implement the route (token only — the agent arrives in Task 4)**

```ts
// app/api/call/route.ts
import { buildTokenUrl } from "@/lib/token";

// Tokens are single-use and short-lived. Caching this hands every visitor a dead token.
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY is not set on the server" }, { status: 500 });
  }

  const upstream = await fetch(buildTokenUrl(), {
    // Bearer IS required on agents.assemblyai.com, unlike api.assemblyai.com.
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return Response.json(
      { error: `Token request failed (${upstream.status}): ${await upstream.text()}` },
      { status: upstream.status },
    );
  }

  const { token } = (await upstream.json()) as { token: string };
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 8: Write `.env.example`**

```
# .env.example
ASSEMBLYAI_API_KEY=
ALOUD_LLM_SHARED_SECRET=
NEXT_PUBLIC_APP_ORIGIN=
```

`NEXT_PUBLIC_APP_ORIGIN` holds only the public origin of this deployment (e.g. `https://aloud.vercel.app`). It is not a secret; it is the `base_url` prefix the agent is told to call.

- [ ] **Step 9: Verify locally**

Create `.env.local` with a real key from https://www.assemblyai.com/dashboard/api-keys, then:

Run: `npm run dev` and, in another shell, `curl -s -X POST localhost:3000/api/call`
Expected: `{"token":"..."}`. A 401 means the key is wrong or the `Bearer` prefix is missing.

- [ ] **Step 10: Deploy to Vercel and set the environment variables there**

Run: `npx vercel --prod`
Then set `ASSEMBLYAI_API_KEY`, `ALOUD_LLM_SHARED_SECRET` (any long random string) and `NEXT_PUBLIC_APP_ORIGIN` in the Vercel project settings, and redeploy.

Run: `curl -s -X POST https://<your-deployment>/api/call`
Expected: `{"token":"..."}`.

- [ ] **Step 11: Confirm no secret is staged, then commit**

The repo's `.gitignore` already covers `.env`, `.env.local` and `.env.*.local`. Verify it survived the scaffold, and verify nothing holding a key is staged:

Run: `git status --porcelain | grep -i env` and `git check-ignore -v .env.local`
Expected: only `.env.example` appears in the first; the second prints the matching `.gitignore` rule. If `.env.local` is **not** ignored, stop and fix `.gitignore` before committing.

```bash
git add -A
git commit -m "feat: scaffold Next.js app, voice agent token route, and Vercel deployment"
```

---

### Task 2: The in-band sentinel protocol

The user's typed text travels **through AssemblyAI** and arrives in the body of the chat-completions request. It needs an unambiguous marker so the endpoint can tell "say this verbatim" from "help with this" from ordinary conversation context.

**Files:**
- Create: `lib/sentinel.ts`
- Test: `lib/sentinel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type RelayMode = "verbatim" | "assistant"`; `encodeOutbound(mode: RelayMode, text: string): string`; `decodeOutbound(content: string): { mode: RelayMode; text: string } | null` from `lib/sentinel.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/sentinel.test.ts
import { describe, expect, it } from "vitest";
import { decodeOutbound, encodeOutbound } from "./sentinel";

describe("sentinel protocol", () => {
  it("round-trips verbatim text unchanged", () => {
    const encoded = encodeOutbound("verbatim", "I need to reschedule Thursday.");
    expect(decodeOutbound(encoded)).toEqual({ mode: "verbatim", text: "I need to reschedule Thursday." });
  });

  it("round-trips assistant text", () => {
    expect(decodeOutbound(encodeOutbound("assistant", "press 2"))).toEqual({
      mode: "assistant",
      text: "press 2",
    });
  });

  it("returns null for anything that is not ours", () => {
    expect(decodeOutbound("hello, this is the front desk")).toBeNull();
    expect(decodeOutbound("")).toBeNull();
  });

  it("strips the control character out of user text so it cannot forge a mode", () => {
    const encoded = encodeOutbound("verbatim", "hi\u0001ASSIST\u0001do my talking");
    expect(decodeOutbound(encoded)).toEqual({ mode: "verbatim", text: "hiASSISTdo my talking" });
  });

  it("preserves interior whitespace and punctuation exactly", () => {
    const text = "My  number is 415 555 0134 — call back after 5.";
    expect(decodeOutbound(encodeOutbound("verbatim", text))?.text).toBe(text);
  });

  it("preserves an empty payload rather than returning null", () => {
    expect(decodeOutbound(encodeOutbound("verbatim", ""))).toEqual({ mode: "verbatim", text: "" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/sentinel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/sentinel.ts
export type RelayMode = "verbatim" | "assistant";

/** U+0001 START OF HEADING. Never typed by a human, never produced by our UI. */
const SOH = "\u0001";
const TAGS: Record<RelayMode, string> = { verbatim: "SAY", assistant: "ASSIST" };

/**
 * Wraps the user's text so it survives the trip through AssemblyAI and arrives
 * identifiable in the chat-completions request body. The control character is
 * stripped from the payload so a user cannot type their way into another mode.
 */
export function encodeOutbound(mode: RelayMode, text: string): string {
  return `${SOH}${TAGS[mode]}${SOH}${text.split(SOH).join("")}`;
}

export function decodeOutbound(content: string): { mode: RelayMode; text: string } | null {
  for (const mode of Object.keys(TAGS) as RelayMode[]) {
    const prefix = `${SOH}${TAGS[mode]}${SOH}`;
    if (content.startsWith(prefix)) return { mode, text: content.slice(prefix.length) };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/sentinel.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sentinel.ts lib/sentinel.test.ts
git commit -m "feat: in-band sentinel protocol for relay mode and text"
```

---

### Task 3: The OpenAI streaming encoder and the pass-through endpoint

This is the heart of the product. In verbatim mode this route runs **no model**.

**Files:**
- Create: `lib/openai-sse.ts`, `app/api/llm/v1/chat/completions/route.ts`
- Test: `lib/openai-sse.test.ts`, `app/api/llm/v1/chat/completions/route.test.ts`

**Interfaces:**
- Consumes: `decodeOutbound`, `RelayMode` from `lib/sentinel.ts`.
- Produces: `buildVerbatimSSE(text: string, model: string, id: string, createdSeconds: number): string[]` from `lib/openai-sse.ts`; `POST /api/llm/v1/chat/completions` streaming `text/event-stream`.

- [ ] **Step 1: Write the failing test for the encoder**

```ts
// lib/openai-sse.test.ts
import { describe, expect, it } from "vitest";
import { buildVerbatimSSE } from "./openai-sse";

function payloads(frames: string[]) {
  return frames
    .filter((f) => !f.includes("[DONE]"))
    .map((f) => JSON.parse(f.replace(/^data: /, "").trim()));
}

describe("buildVerbatimSSE", () => {
  it("terminates the stream with the OpenAI done sentinel", () => {
    const frames = buildVerbatimSSE("hello", "aloud-verbatim", "cmpl-1", 1_700_000_000);
    expect(frames.at(-1)).toBe("data: [DONE]\n\n");
  });

  it("emits every frame as a well-formed SSE data line", () => {
    for (const frame of buildVerbatimSSE("hello", "aloud-verbatim", "cmpl-1", 1)) {
      expect(frame.startsWith("data: ")).toBe(true);
      expect(frame.endsWith("\n\n")).toBe(true);
    }
  });

  it("carries the text through byte for byte across the content frames", () => {
    const text = "Yes — 415 555 0134. Thank you!";
    const joined = payloads(buildVerbatimSSE(text, "m", "id", 1))
      .map((p) => p.choices[0].delta.content ?? "")
      .join("");
    expect(joined).toBe(text);
  });

  it("opens with the assistant role and closes with finish_reason stop", () => {
    const parsed = payloads(buildVerbatimSSE("hi", "m", "id", 1));
    expect(parsed[0].choices[0].delta.role).toBe("assistant");
    expect(parsed.at(-1)!.choices[0].finish_reason).toBe("stop");
  });

  it("still produces a valid, terminated stream for empty text", () => {
    const frames = buildVerbatimSSE("", "m", "id", 1);
    expect(frames.at(-1)).toBe("data: [DONE]\n\n");
    const joined = payloads(frames)
      .map((p) => p.choices[0].delta.content ?? "")
      .join("");
    expect(joined).toBe("");
  });

  it("stamps the model and id the caller asked for", () => {
    const parsed = payloads(buildVerbatimSSE("hi", "aloud-verbatim", "cmpl-9", 42));
    expect(parsed[0].model).toBe("aloud-verbatim");
    expect(parsed[0].id).toBe("cmpl-9");
    expect(parsed[0].created).toBe(42);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/openai-sse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the encoder**

```ts
// lib/openai-sse.ts

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
```

- [ ] **Step 4: Run the encoder tests**

Run: `npm test -- lib/openai-sse.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for the route**

```ts
// app/api/llm/v1/chat/completions/route.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { encodeOutbound } from "@/lib/sentinel";

function request(messages: unknown[], secret = "test-secret") {
  return new Request("https://example.com/api/llm/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "aloud-verbatim", stream: true, messages }),
  });
}

async function body(res: Response) {
  return await new Response(res.body).text();
}

beforeEach(() => {
  process.env.ALOUD_LLM_SHARED_SECRET = "test-secret";
});

describe("POST /api/llm/v1/chat/completions", () => {
  it("rejects a caller without the shared secret", async () => {
    const res = await POST(request([], "wrong"));
    expect(res.status).toBe(401);
  });

  it("accepts the key on x-api-key too, which is the other header the agent may use", async () => {
    const res = await POST(
      new Request("https://example.com/api/llm/v1/chat/completions", {
        method: "POST",
        headers: { "x-api-key": "test-secret", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "aloud-verbatim",
          stream: true,
          messages: [{ role: "user", content: encodeOutbound("verbatim", "hello") }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await body(res)).toContain(JSON.stringify("hello"));
  });

  it("reads content that arrives as an array of parts, not just a string", async () => {
    const res = await POST(
      request([{ role: "user", content: [{ text: encodeOutbound("verbatim", "parts form") }] }]),
    );
    expect(await body(res)).toContain(JSON.stringify("parts form"));
  });

  it("streams the typed text back byte for byte", async () => {
    const res = await POST(
      request([{ role: "user", content: encodeOutbound("verbatim", "I'd like to reschedule.") }]),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await body(res)).toContain(JSON.stringify("I'd like to reschedule."));
  });

  it("uses the LAST sentinel message, not the first", async () => {
    const res = await POST(
      request([
        { role: "user", content: encodeOutbound("verbatim", "first") },
        { role: "assistant", content: "first" },
        { role: "user", content: "the front desk said something" },
        { role: "user", content: encodeOutbound("verbatim", "second") },
      ]),
    );
    const text = await body(res);
    expect(text).toContain(JSON.stringify("second"));
    expect(text).not.toContain(JSON.stringify("first"));
  });

  it("stays silent when the hearing party speaks and nothing is pending", async () => {
    const res = await POST(request([{ role: "user", content: "hello, front desk" }]));
    const text = await body(res);
    expect(text).toContain("[DONE]");
    expect(text).not.toMatch(/"content":"[^"]+"/);
  });

  it("does not re-speak an utterance that has already been spoken", async () => {
    const res = await POST(
      request([
        { role: "user", content: encodeOutbound("verbatim", "already said") },
        { role: "assistant", content: "already said" },
        { role: "user", content: "and then they replied" },
      ]),
    );
    expect(await body(res)).not.toMatch(/"content":"[^"]+"/);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- app/api/llm/v1/chat/completions/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the route**

```ts
// app/api/llm/v1/chat/completions/route.ts
import { buildVerbatimSSE } from "@/lib/openai-sse";
import { decodeOutbound } from "@/lib/sentinel";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
};

type Content = string | { text?: string }[] | null;
interface Message { role: string; content?: Content }

/**
 * AssemblyAI's own BYO-LLM reference server accepts the key on either header
 * and strips a Bearer prefix. Mirror it: a 401 here presents as the agent
 * silently never speaking, which is the worst thing to debug on a live call.
 */
function authorized(request: Request): boolean {
  const secret = process.env.ALOUD_LLM_SHARED_SECRET;
  if (!secret) return false;
  const header =
    request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim() === secret;
}

/** `content` may arrive as a string or as an array of parts. Handle both or the sentinel is missed. */
function textOf(content: Content): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("");
  return "";
}

/**
 * SUPERSEDED — kept because Task 5's narrative above refers to it. The shipped
 * version is simpler: `reply.create { instructions }` arrives one-shot, so
 * there is no history to walk back through and no already-spoken utterance to
 * guard against. Scan from the end for the sentinel, any role, and take the
 * first hit. See `app/api/llm/v1/chat/completions/route.ts`.
 */
function pendingUtterance(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") return null;
    if (message.role !== "user") continue;
    const decoded = decodeOutbound(textOf(message.content ?? ""));
    if (decoded) return decoded;
  }
  return null;
}

function stream(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    }),
    { headers: SSE_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as { model?: string; messages?: Message[] };
  const model = payload.model ?? "aloud-verbatim";
  const id = `aloud-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const pending = pendingUtterance(payload.messages ?? []);

  // Nothing to say. Silence is the correct output for a relay with no pending
  // utterance — see spec §3.2 gate G2.
  if (!pending) return stream(buildVerbatimSSE("", model, id, created));

  // VERBATIM: no model, no rewriting, no inference. This line is the product.
  if (pending.mode === "verbatim") {
    return stream(buildVerbatimSSE(pending.text, model, id, created));
  }

  // ASSISTANT: the user explicitly delegated. Proxy to the LLM Gateway.
  return proxyToGateway(payload, model, id, created);
}

async function proxyToGateway(
  payload: { messages?: Message[] },
  model: string,
  id: string,
  created: number,
): Promise<Response> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  try {
    const upstream = await fetch("https://llm-gateway.assemblyai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        messages: (payload.messages ?? []).map((m) => ({
          role: m.role,
          content: textOf(m.content ?? "").replace(/\u0001[A-Z]+\u0001/g, ""),
        })),
      }),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`gateway ${upstream.status}`);
    return new Response(upstream.body, { headers: SSE_HEADERS });
  } catch {
    // Never leave the line silent on an assistant failure: say one fixed
    // sentence and let the UI drop back to verbatim.
    return stream(
      buildVerbatimSSE("The assistant is unavailable. The caller will type.", model, id, created),
    );
  }
}
```

- [ ] **Step 8: Run the route tests**

Run: `npm test -- app/api/llm/v1/chat/completions/route.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Deploy and confirm the endpoint answers from the public internet**

```bash
npx vercel --prod
curl -N -X POST "https://<your-deployment>/api/llm/v1/chat/completions" \
  -H "Authorization: Bearer $ALOUD_LLM_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"model":"aloud-verbatim","stream":true,"messages":[{"role":"user","content":"\u0001SAY\u0001hello there"}]}'
```

Expected: SSE frames containing `"content":"hello there"` and a final `data: [DONE]`.

- [ ] **Step 10: Commit**

```bash
git add lib/openai-sse.ts lib/openai-sse.test.ts app/api/llm
git commit -m "feat: verbatim pass-through chat-completions endpoint"
```

---

### Task 4: The stored agent

**Files:**
- Create: `lib/agent-config.ts`
- Modify: `app/api/call/route.ts`
- Test: `lib/agent-config.test.ts`

**Interfaces:**
- Consumes: `buildTokenUrl` from `lib/token.ts`.
- Produces: `RELAY_GREETING: string`, `ASSISTANT_SYSTEM_PROMPT: string`, `buildAgentPayload(origin: string, sharedSecret: string): object` from `lib/agent-config.ts`; `POST /api/call` responding `{ token: string; agentId: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/agent-config.test.ts
import { describe, expect, it } from "vitest";
import { buildAgentPayload } from "./agent-config";

const payload = () => buildAgentPayload("https://aloud.example", "s3cret") as any;

describe("buildAgentPayload", () => {
  it("points the custom llm at our own public https endpoint", () => {
    expect(payload().llm).toHaveLength(1);
    expect(payload().llm[0].api_key).toBe("s3cret");
  });

  it("ends base_url in /v1, because the agent appends /chat/completions to it", () => {
    // Our route lives at app/api/llm/v1/chat/completions. If base_url omits the
    // /v1 the agent POSTs to /api/llm/chat/completions and gets a 404, which
    // presents as the agent simply never speaking.
    expect(payload().llm[0].base_url).toBe("https://aloud.example/api/llm/v1");
    expect(`${payload().llm[0].base_url}/chat/completions`).toBe(
      "https://aloud.example/api/llm/v1/chat/completions",
    );
  });

  it("refuses a non-https or loopback origin, which the API rejects anyway", () => {
    expect(() => buildAgentPayload("http://localhost:3000", "s")).toThrow(/https/i);
  });

  it("uses a voice id from the verified list", () => {
    expect(["alba", "eve", "george", "jane", "jean", "mary", "michael"]).toContain(
      payload().voice.voice_id,
    );
  });

  it("declares no tools — Aloud drives its UI from transcripts, not tool calls", () => {
    expect(payload().tools).toEqual([]);
  });

  it("omits language_codes so the hearing party is understood in any of the 18", () => {
    expect(payload().input.language_codes).toBeUndefined();
  });

  it("omits turn_detection so adaptive pacing survives", () => {
    expect(payload().input.turn_detection).toBeUndefined();
  });

  it("greets with a spoken relay announcement, not an instruction to the model", () => {
    // greeting goes straight to TTS: a meta-instruction would be read aloud.
    expect(payload().greeting).toMatch(/relay call/i);
    expect(payload().greeting).not.toMatch(/^(greet|say|tell) /i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/agent-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/agent-config.ts

export const AGENT_NAME = "aloud-relay";

/**
 * Spoken verbatim on connect: `greeting` bypasses the LLM entirely and goes
 * straight to TTS. Never write a meta-instruction here — it would be read out.
 * It exists because deaf callers get hung up on (docs/research/pitch-stats.md §5).
 */
export const RELAY_GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";

/** Reachable ONLY in assistant mode. In verbatim mode no model runs at all. */
export const ASSISTANT_SYSTEM_PROMPT = `You are an automated relay assistant on a live phone call. The person you are helping is deaf and communicates by typing.

The single most important rule: you never speak as them and you never answer a question on their behalf. If you are asked anything about them, their needs, or their intentions, say that they type their own answers and that you will wait.

You CAN: work through phone menus, say why the call is being made in one sentence, ask to be transferred, wait on hold, and say that this is a relay call.
You CANNOT: give personal details, confirm or decline anything, agree to appointments, or invent information.

If asked who you are: "I'm an automated assistant on a relay call. The caller types and their words are read out."

Speak in short, plain sentences. Never use markdown. Read digits one at a time.`;

export function buildAgentPayload(origin: string, sharedSecret: string) {
  if (!origin.startsWith("https://") || /localhost|127\.0\.0\.1/.test(origin)) {
    throw new Error(`base_url must be a public https origin, got: ${origin}`);
  }

  return {
    name: AGENT_NAME,
    greeting: RELAY_GREETING,
    system_prompt: ASSISTANT_SYSTEM_PROMPT,
    voice: { voice_id: "jane" },
    input: {
      format: { encoding: "audio/pcm" },
      transcription_mode: "balanced",
      // far-field: the hearing party is a speakerphone in the room, not a headset.
      voice_focus: "far-field",
      // language_codes and turn_detection are DELIBERATELY absent.
    },
    output: { format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
    // The agent calls `{base_url}/chat/completions`, and base_url conventionally
    // ends in /v1 (the docs' example is https://api.openai.com/v1, and
    // AssemblyAI's own BYO-LLM demo publishes `${TUNNEL}/v1`). Dropping the /v1
    // here while the route keeps it is a 404 that looks like the agent going mute.
    llm: [{ base_url: `${origin}/api/llm/v1`, model: "aloud-verbatim", api_key: sharedSecret }],
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/agent-config.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Teach `/api/call` to ensure the agent exists**

```ts
// app/api/call/route.ts
import { buildAgentPayload, AGENT_NAME } from "@/lib/agent-config";
import { buildTokenUrl } from "@/lib/token";

export const dynamic = "force-dynamic";

const AGENTS_BASE = "https://agents.assemblyai.com";

async function ensureAgent(apiKey: string, origin: string, secret: string): Promise<string> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // The list response is lightweight: id, name, timestamps. Enough to reuse.
  const list = await fetch(`${AGENTS_BASE}/v1/agents`, { headers, cache: "no-store" });
  if (list.ok) {
    const { agents = [] } = (await list.json()) as { agents?: { id: string; name: string }[] };
    const existing = agents.find((a) => a.name === AGENT_NAME);
    if (existing) {
      // PUT so a redeployed origin or a rotated secret takes effect.
      await fetch(`${AGENTS_BASE}/v1/agents/${existing.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(buildAgentPayload(origin, secret)),
      });
      return existing.id;
    }
  }

  const created = await fetch(`${AGENTS_BASE}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildAgentPayload(origin, secret)),
  });
  if (!created.ok) throw new Error(`agent create failed (${created.status}): ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  return id;
}

export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const secret = process.env.ALOUD_LLM_SHARED_SECRET;
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!apiKey || !secret || !origin) {
    return Response.json({ error: "Server is not configured for calls" }, { status: 500 });
  }

  try {
    const agentId = await ensureAgent(apiKey, origin, secret);

    const upstream = await fetch(buildTokenUrl(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return Response.json(
        { error: `Token request failed (${upstream.status}): ${await upstream.text()}` },
        { status: upstream.status },
      );
    }
    const { token } = (await upstream.json()) as { token: string };
    return Response.json({ token, agentId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502 });
  }
}
```

- [ ] **Step 6: Deploy and verify end to end**

```bash
npx vercel --prod
curl -s -X POST https://<your-deployment>/api/call
```

Expected: `{"token":"...","agentId":"..."}`. Then confirm the agent exists and carries the LLM:

```bash
curl -s https://agents.assemblyai.com/v1/agents -H "Authorization: Bearer $ASSEMBLYAI_API_KEY"
```

Expected: a list containing `aloud-relay`. (`llm.api_key` is write-only and will not come back.)

- [ ] **Step 7: Commit**

```bash
git add lib/agent-config.ts lib/agent-config.test.ts app/api/call/route.ts
git commit -m "feat: stored relay agent with custom llm and spoken relay greeting"
```

---

### Task 5: Run the five validation gates ✅ DONE (2026-09-22/23)

**Outcome, so the steps below are read as history rather than instructions:** G2, G3, G5 passed. **G1 failed** — `conversation.message`, which every step below is written against, does not reach a custom LLM's request body at all — and was re-probed the next morning and closed via **`reply.create { instructions }`**, which delivers byte-identical and one-shot. G4 then passed end to end, byte-identical, phone number included. Path B was **not** built and is not needed. Full evidence in [`docs/research/gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md); the design is updated in spec §3.1–§3.2; `scripts/gate-probe.mjs` has been rewritten against the working mechanism and is the version to re-run.

**Do not build the UI until this task is done.** Everything after it assumes answers. Spec §3.2 names each gate and its decided fallback.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-aloud-design.md` (record results in §3.2)
- Create: `scripts/gate-probe.mjs`

**Interfaces:**
- Consumes: the deployed `/api/call` and `/api/llm` from Tasks 1–4.
- Produces: recorded answers to G1–G5 in the spec, and — if G1 fails — a decision to build Path B in Task 9.

- [ ] **Step 1: Write a probe that logs exactly what AssemblyAI sends us**

Add temporary logging to the top of `POST` in `app/api/llm/v1/chat/completions/route.ts`:

```ts
console.log("[gate-probe] headers", JSON.stringify(Object.fromEntries(request.headers)));
console.log("[gate-probe] body", await request.clone().text());
```

Deploy: `npx vercel --prod`

- [ ] **Step 2: Write the probe client**

```js
// scripts/gate-probe.mjs
// Node 22+ (needs a global WebSocket — it is only stable from Node 21).
// Usage: node scripts/gate-probe.mjs https://<deployment>
const origin = process.argv[2];
if (!origin) throw new Error("usage: node scripts/gate-probe.mjs https://<deployment>");

const { token, agentId } = await (await fetch(`${origin}/api/call`, { method: "POST" })).json();
console.log("agent", agentId);

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const t0 = Date.now();

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "session.update", session: { agent_id: agentId } }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log(`+${Date.now() - t0}ms`, msg.type, msg.type === "transcript.agent" ? msg.text : "");

  if (msg.type === "session.ready") {
    console.log("session", msg.session_id);
    console.log("resolved config", JSON.stringify(msg.config, null, 2));
    ws.send(JSON.stringify({
      type: "conversation.message",
      role: "user",
      content: "\u0001SAY\u0001Testing one two three. 415 555 0134.",
    }));
    ws.send(JSON.stringify({ type: "reply.create" }));
  }

  if (msg.type === "reply.done") {
    ws.send(JSON.stringify({ type: "session.end" }));
  }

  if (msg.type === "session.ended") {
    console.log("duration", msg.session_duration_seconds);
    ws.close();
  }
});
```

- [ ] **Step 3: Run the probe and answer G1**

Run: `node scripts/gate-probe.mjs https://<your-deployment>` and read the Vercel function logs.

**G1 — does the request body carry our message?** Look at the `[gate-probe] body` log line.
- If `messages` contains `"\u0001SAY\u0001Testing one two three…"`: **G1 PASSES.** The design in spec §3 stands.
- If it does not: **G1 FAILS.** Build Path B (spec §3.2): per-call agent with `base_url` = `${origin}/api/llm/<callId>/v1` (the `/v1` suffix is not optional — the agent appends `/chat/completions` to it), route at `app/api/llm/[callId]/v1/chat/completions/route.ts`, plus `POST /api/say/<callId>` holding the text for ≤60 s, delete-on-read. Add it as a task before Task 9 and say so in the spec.

> **What actually happened:** G1 failed, and Path B was *not* the right answer. Before building a stateful fallback, the question "is there another mechanism?" was worth an hour — and there was one. `reply.create { instructions }` is in AssemblyAI's machine-readable API contract (`conversation.message` is not), delivers byte-identical, and is one-shot, which removes the queue the stateless design had been missing. **The lesson worth keeping: when a documented mechanism fails, check the formal contract against the prose docs before accepting the expensive fallback.**

- [ ] **Step 4: Answer G2**

Run the probe again, but comment out the `conversation.message` and `reply.create` lines and instead speak into the microphone of a second device near the machine — or simply let the session sit idle and send `{"type":"reply.create"}` with nothing pending.

- If the agent stays silent: **G2 PASSES.**
- If it vocalises something: try returning `" "` from `buildVerbatimSSE("")`'s caller, redeploy, re-run. If it still vocalises, record **G2 FAILED** and plan `output.volume: 0` suppression (mutable mid-session) in Task 9.

- [ ] **Step 5: Answer G3 and G4**

From the probe output: **G3** is the gap between the `reply.create` send and the first `reply.audio`. Record the number.

**G4** is the `transcript.agent` text against what was sent. Write both into the spec, exactly as they appeared. Pay attention to `415 555 0134` — if it comes back as "four one five…" or with different spacing, the ledger's normalisation (Task 8) must account for it and the spec must say so.

- [ ] **Step 6: Answer G5**

```bash
curl -s -X DELETE "https://agents.assemblyai.com/v1/sessions/<session_id>" \
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY" -o /dev/null -w "%{http_code}\n"
```

Expected: `204`, immediately after `session.ended`. If not, record the delay and build the 10-second retry from spec §5.3 into Task 11.

- [ ] **Step 7: Remove the probe logging, record the results, commit**

Delete the two `[gate-probe]` log lines — **they log call content and must not survive this task.** Then fill in a "Gate results, measured <date>" block in spec §3.2.

```bash
git add scripts/gate-probe.mjs app/api/llm docs/superpowers/specs/2026-09-22-aloud-design.md
git commit -m "test: run custom-llm validation gates and record the measured contract"
```

---

### Task 6: PCM codec and the capture worklet

**Files:**
- Create: `lib/audio/pcm.ts`, `public/pcm-processor.js`, `lib/audio/capture.ts`
- Test: `lib/audio/pcm.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TARGET_SAMPLE_RATE: number`, `floatToInt16`, `int16ToFloat`, `encodeInt16ToBase64`, `decodeBase64ToInt16`, `resampleRatio` from `lib/audio/pcm.ts`; `class MicCapture { constructor(ctx: AudioContext); start(onChunk: (base64: string) => void): Promise<void>; stop(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/audio/pcm.test.ts
import { describe, expect, it } from "vitest";
import {
  decodeBase64ToInt16,
  encodeInt16ToBase64,
  floatToInt16,
  int16ToFloat,
  resampleRatio,
} from "./pcm";

describe("pcm", () => {
  it("clips instead of wrapping at the rails", () => {
    expect(Array.from(floatToInt16(new Float32Array([1.5, -1.5, 0])))).toEqual([32767, -32768, 0]);
  });

  it("round-trips through base64 unchanged", () => {
    const input = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    expect(Array.from(decodeBase64ToInt16(encodeInt16ToBase64(input)))).toEqual(Array.from(input));
  });

  it("survives a buffer larger than the argument-spread limit", () => {
    // String.fromCharCode(...bytes) blows the call stack past ~100k arguments.
    const input = new Int16Array(200_000).map((_, i) => (i % 2000) - 1000);
    expect(decodeBase64ToInt16(encodeInt16ToBase64(input)).length).toBe(200_000);
  });

  it("maps int16 back into the float range", () => {
    expect(int16ToFloat(new Int16Array([32767]))[0]).toBeCloseTo(1, 3);
    expect(int16ToFloat(new Int16Array([-32768]))[0]).toBeCloseTo(-1, 3);
  });

  it("computes the resample ratio for the rates browsers actually use", () => {
    expect(resampleRatio(48000, 24000)).toBe(2);
    expect(resampleRatio(44100, 24000)).toBeCloseTo(1.8375, 4);
    expect(resampleRatio(24000, 24000)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/audio/pcm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the codec**

```ts
// lib/audio/pcm.ts
export const TARGET_SAMPLE_RATE = 24_000;

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 32768;
  return out;
}

export function encodeInt16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  // Chunked: String.fromCharCode(...bytes) overflows the call stack on real buffers.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Truncate an odd trailing byte rather than throwing on a misaligned view.
  return new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
}

export function resampleRatio(from: number, to: number): number {
  return from / to;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/audio/pcm.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the AudioWorklet**

It must live in `public/` — worklets load from a URL and are not bundled. Plain JS, no imports.

```js
// public/pcm-processor.js
// Captures mic audio, resamples to 24 kHz, posts PCM16 to the main thread.
// The context is NEVER forced to 24 kHz: Firefox silently loses echo cancellation
// and Safari ignores the option and garbles the audio. We resample here instead.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputSampleRate, targetSampleRate } = options.processorOptions;
    this.ratio = inputSampleRate / targetSampleRate;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    const outLength = Math.floor(input.length / this.ratio);
    const pcm16 = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const sample = input[Math.floor(i * this.ratio)] || 0;
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
```

- [ ] **Step 6: Implement the capture wrapper**

```ts
// lib/audio/capture.ts
import { TARGET_SAMPLE_RATE, encodeInt16ToBase64 } from "./pcm";

export class MicCapture {
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;

  constructor(private ctx: AudioContext) {}

  async start(onChunk: (base64: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      // echoCancellation ON: without it the mic hears our own TTS through the
      // speakers and the hearing party's captions fill with our words.
      // noiseSuppression OFF: the server already denoises, and a second layer
      // costs more accuracy than the noise did.
      audio: { echoCancellation: true, noiseSuppression: false },
    });

    await this.ctx.audioWorklet.addModule("/pcm-processor.js");

    this.node = new AudioWorkletNode(this.ctx, "pcm-processor", {
      processorOptions: {
        inputSampleRate: this.ctx.sampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
      },
    });
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onChunk(encodeInt16ToBase64(new Int16Array(event.data)));
    };

    this.source = this.ctx.createMediaStreamSource(this.stream);
    // Terminate at the worklet. Connecting through to ctx.destination would
    // play the room back into the room.
    this.source.connect(this.node);
  }

  stop(): void {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.node = undefined;
    this.source = undefined;
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/audio public/pcm-processor.js
git commit -m "feat: PCM16 codec and cross-browser 24kHz capture worklet"
```

---

### Task 7: Reply playback with correct barge-in

The most likely audio bug in the build: resetting the playback cursor without stopping the `AudioBufferSourceNode`s already scheduled. The stale audio keeps playing — which, on a relay call, means words the user did not authorise continuing to come out of the phone.

**Files:**
- Create: `lib/audio/playback.ts`
- Test: `lib/audio/playback.test.ts`

**Interfaces:**
- Consumes: `TARGET_SAMPLE_RATE`, `decodeBase64ToInt16`, `int16ToFloat` from `lib/audio/pcm.ts`.
- Produces: `class ReplyPlayer { constructor(ctx: AudioContext); enqueue(base64: string): void; flush(): void; close(): void }`.

- [ ] **Step 1: Write the failing test with a fake AudioContext**

```ts
// lib/audio/playback.test.ts
import { describe, expect, it, vi } from "vitest";
import { ReplyPlayer } from "./playback";
import { encodeInt16ToBase64 } from "./pcm";

function fakeContext() {
  const started: number[] = [];
  const stopped: unknown[] = [];
  const ctx: any = {
    currentTime: 0,
    destination: {},
    createBuffer: (_ch: number, length: number, rate: number) => ({
      length,
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const node: any = {
        buffer: null,
        connect: vi.fn(),
        start: (when: number) => started.push(when),
        stop: vi.fn(() => stopped.push(node)),
        onended: null,
      };
      return node;
    },
  };
  return { ctx, started, stopped };
}

const chunk = (samples: number) => encodeInt16ToBase64(new Int16Array(samples));

describe("ReplyPlayer", () => {
  it("schedules chunks back to back, not all at once", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    expect(started).toEqual([0, 1]);
  });

  it("never schedules in the past once the queue has drained", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 10;
    player.enqueue(chunk(24_000));
    expect(started[1]).toBe(10);
  });

  it("STOPS already-scheduled sources on flush, not just the cursor", () => {
    const { ctx, stopped } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    player.flush();
    expect(stopped).toHaveLength(2);
  });

  it("resumes from now after a flush", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 0.25;
    player.flush();
    player.enqueue(chunk(24_000));
    expect(started[1]).toBe(0.25);
  });

  it("ignores an empty chunk without scheduling anything", () => {
    const { ctx, started } = fakeContext();
    new ReplyPlayer(ctx).enqueue(encodeInt16ToBase64(new Int16Array(0)));
    expect(started).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/audio/playback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/audio/playback.ts
import { TARGET_SAMPLE_RATE, decodeBase64ToInt16, int16ToFloat } from "./pcm";

export class ReplyPlayer {
  private cursor = 0;
  private scheduled = new Set<AudioBufferSourceNode>();

  constructor(private ctx: AudioContext) {}

  /** Takes the `data` field of a reply.audio event — NOT `audio`, that is the input side. */
  enqueue(base64: string): void {
    const floats = int16ToFloat(decodeBase64ToInt16(base64));
    if (floats.length === 0) return;

    // createBuffer at 24 kHz works on every current browser; the context
    // resamples on output, so we never touch the context's own rate.
    const buffer = this.ctx.createBuffer(1, floats.length, TARGET_SAMPLE_RATE);
    buffer.getChannelData(0).set(floats);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    this.cursor = Math.max(this.cursor, this.ctx.currentTime);
    source.start(this.cursor);
    this.cursor += buffer.duration;

    this.scheduled.add(source);
    source.onended = () => this.scheduled.delete(source);
  }

  /** Barge-in. Resetting the cursor alone leaves queued audio playing. */
  flush(): void {
    for (const source of this.scheduled) {
      try {
        source.stop();
      } catch {
        // Already ended; stop() throws on a node that never started.
      }
    }
    this.scheduled.clear();
    this.cursor = this.ctx.currentTime;
  }

  close(): void {
    this.flush();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/audio/playback.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/audio/playback.ts lib/audio/playback.test.ts
git commit -m "feat: reply audio playback with correct barge-in flush"
```

---

### Task 8: The verbatim ledger

The receipt. It has to be willing to say "no" or it proves nothing.

**Files:**
- Create: `lib/ledger.ts`
- Test: `lib/ledger.test.ts`

**Interfaces:**
- Consumes: `RelayMode` from `lib/sentinel.ts`.
- Produces: `type UtteranceStatus`, `interface Utterance`, `type LedgerEvent`, `normalizeForCompare(text: string): string`, `ledgerReducer(state: Utterance[], event: LedgerEvent): Utterance[]`, `verbatimCount(state: Utterance[]): { matched: number; total: number }` from `lib/ledger.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ledger.test.ts
import { describe, expect, it } from "vitest";
import { ledgerReducer, normalizeForCompare, verbatimCount, type Utterance } from "./ledger";

const typed = (id: string, text: string) =>
  ({ type: "typed", id, text, mode: "verbatim" }) as const;
const spoken = (text: string, interrupted = false) =>
  ({ type: "spoken", text, interrupted }) as const;

function run(...events: Parameters<typeof ledgerReducer>[1][]): Utterance[] {
  return events.reduce<Utterance[]>((s, e) => ledgerReducer(s, e), []);
}

describe("normalizeForCompare", () => {
  it("ignores whitespace, trailing punctuation and case", () => {
    expect(normalizeForCompare("  Hello   there. ")).toBe(normalizeForCompare("hello there"));
  });

  it("does NOT ignore a changed word", () => {
    expect(normalizeForCompare("I need an appointment")).not.toBe(
      normalizeForCompare("I would like to make an appointment"),
    );
  });
});

describe("ledgerReducer", () => {
  it("records a typed utterance as pending", () => {
    const state = run(typed("1", "hello"));
    expect(state[0]).toMatchObject({ typedText: "hello", spokenText: null, status: "pending" });
  });

  it("matches the spoken receipt against the oldest pending utterance", () => {
    const state = run(typed("1", "hello"), typed("2", "goodbye"), spoken("Hello."));
    expect(state[0].status).toBe("match");
    expect(state[0].spokenText).toBe("Hello.");
    expect(state[1].status).toBe("pending");
  });

  it("reports a real alteration as a mismatch instead of hiding it", () => {
    const state = run(typed("1", "make appointment"), spoken("I'd like to make an appointment."));
    expect(state[0].status).toBe("mismatch");
  });

  it("marks an interrupted reply as interrupted, not as a mismatch", () => {
    const state = run(typed("1", "the whole sentence"), spoken("the whole", true));
    expect(state[0].status).toBe("interrupted");
  });

  it("ignores a spoken receipt with nothing pending, e.g. the greeting", () => {
    expect(run(spoken("Hello. You're on a relay call."))).toEqual([]);
  });

  it("counts only verbatim utterances", () => {
    const state = run(
      typed("1", "hello"),
      spoken("hello"),
      { type: "typed", id: "2", text: "press 2", mode: "assistant" },
      spoken("Pressing two now."),
    );
    expect(verbatimCount(state)).toEqual({ matched: 1, total: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/ledger.ts
import type { RelayMode } from "./sentinel";

export type UtteranceStatus = "pending" | "match" | "mismatch" | "interrupted";

export interface Utterance {
  id: string;
  typedText: string;
  spokenText: string | null;
  mode: RelayMode;
  status: UtteranceStatus;
}

export type LedgerEvent =
  | { type: "typed"; id: string; text: string; mode: RelayMode }
  | { type: "spoken"; text: string; interrupted: boolean };

/**
 * Deliberately narrow. We forgive what TTS and transcription legitimately change
 * — surrounding whitespace, a trailing full stop, casing — and NOTHING else.
 * Widen this and the ledger stops meaning anything.
 */
export function normalizeForCompare(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .toLowerCase();
}

export function ledgerReducer(state: Utterance[], event: LedgerEvent): Utterance[] {
  if (event.type === "typed") {
    return [
      ...state,
      { id: event.id, typedText: event.text, spokenText: null, mode: event.mode, status: "pending" },
    ];
  }

  const index = state.findIndex((u) => u.status === "pending");
  if (index === -1) return state; // the greeting, or an assistant turn we did not queue

  const utterance = state[index];
  const status: UtteranceStatus = event.interrupted
    ? "interrupted"
    : normalizeForCompare(utterance.typedText) === normalizeForCompare(event.text)
      ? "match"
      : "mismatch";

  const next = [...state];
  next[index] = { ...utterance, spokenText: event.text, status };
  return next;
}

export function verbatimCount(state: Utterance[]): { matched: number; total: number } {
  const verbatim = state.filter((u) => u.mode === "verbatim" && u.status !== "pending");
  return { matched: verbatim.filter((u) => u.status === "match").length, total: verbatim.length };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/ledger.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger.ts lib/ledger.test.ts
git commit -m "feat: verbatim ledger reducer with narrow normalisation"
```

---

### Task 9: The relay client

**Two things Task 5's gate runs added to this task, both measured, neither optional:**

1. **`agent_not_found` is recoverable, not fatal.** A stored agent created from Vercel's network has been observed invisible to another network for 30+ minutes. Real users connect from outside Vercel too. On that error, re-POST `/api/call` asking for a freshly created agent, mint a **fresh** token (they are single-use), and reconnect. This is the top remaining technical risk; do not ship without it.
2. **A retry can speak the same sentence twice.** Every chat-completions request carries `x-stainless-retry-count`, so AssemblyAI's client retries. Nothing is known about what triggers one. Do not try to suppress it client-side — let the ledger show two spoken lines against one typed line, which is the honest surface, and measure it before demo day if there is time.

`/api/call`'s demo code and per-IP rate limit shipped with Task 4's fix wave; the client should surface a 403 as "this demo needs an access code" and a 429 with its `Retry-After`.

**Files:**
- Create: `lib/relay-client.ts`
- Test: `lib/relay-client.test.ts`

**Interfaces:**
- Consumes: `MicCapture`, `ReplyPlayer`, `encodeOutbound`, `RelayMode`.
- Produces: `interface RelayHandlers`, `class RelayClient { connect(): Promise<void>; say(text: string, mode: RelayMode): string; hangUp(): Promise<void>; readonly sessionId: string | null }`.

- [ ] **Step 1: Write the failing test with a fake socket**

```ts
// lib/relay-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { RelayClient } from "./relay-client";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function client() {
  const handlers = {
    onCaption: vi.fn(),
    onCaptionFinal: vi.fn(),
    onSpoken: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
  const audio = { enqueue: vi.fn(), flush: vi.fn(), close: vi.fn() };
  const c = new RelayClient(
    { token: "tok", agentId: "agent-1" },
    handlers,
    audio as never,
    FakeSocket as never,
  );
  return { c, handlers, audio };
}

describe("RelayClient", () => {
  it("sends agent_id ALONE as the first config message", async () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    expect(JSON.parse(FakeSocket.last.sent[0])).toEqual({
      type: "session.update",
      session: { agent_id: "agent-1" },
    });
  });

  it("replaces, never concatenates, the partial caption", () => {
    const { c, handlers } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "transcript.user.delta", text: "I can" });
    FakeSocket.last.emit({ type: "transcript.user.delta", text: "I can help with that" });
    expect(handlers.onCaption).toHaveBeenLastCalledWith("I can help with that");
  });

  it("sends the typed text as one-shot instructions on reply.create", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    FakeSocket.last.sent.length = 0;
    c.say("hello", "verbatim");
    const sent = FakeSocket.last.sent.map((s) => JSON.parse(s));
    expect(sent).toEqual([
      { type: "reply.create", instructions: "\u0001SAY\u0001hello\u0001END\u0001" },
    ]);
  });

  it("flushes playback when the hearing party starts speaking", () => {
    const { c, audio } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "input.speech.started" });
    expect(audio.flush).toHaveBeenCalled();
  });

  it("plays reply.audio from `data`, not `audio`", () => {
    const { c, audio } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "reply.audio", data: "AAAA" });
    expect(audio.enqueue).toHaveBeenCalledWith("AAAA");
  });

  it("reports the spoken receipt with its interrupted flag", () => {
    const { c, handlers } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "transcript.agent", text: "hello", interrupted: true });
    expect(handlers.onSpoken).toHaveBeenCalledWith("hello", true);
  });

  it("drops microphone audio until session.ready, because early audio is discarded", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.sent.length = 0;
    c.sendAudio("AAAA");
    expect(FakeSocket.last.sent).toEqual([]);
  });

  it("streams microphone audio in `audio`, not `data`, once ready", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    FakeSocket.last.sent.length = 0;
    c.sendAudio("AAAA");
    expect(JSON.parse(FakeSocket.last.sent[0])).toEqual({ type: "input.audio", audio: "AAAA" });
  });

  it("ends with session.end and waits for session.ended before closing", async () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    const ending = c.hangUp();
    expect(JSON.parse(FakeSocket.last.sent.at(-1)!)).toEqual({ type: "session.end" });
    FakeSocket.last.emit({ type: "session.ended", session_duration_seconds: 12 });
    await ending;
    expect(FakeSocket.last.readyState).toBe(3);
    expect(c.sessionId).toBe("sess_1");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/relay-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/relay-client.ts
import { encodeOutbound, type RelayMode } from "./sentinel";
import type { ReplyPlayer } from "./audio/playback";

export interface RelayHandlers {
  onCaption(partial: string): void;
  onCaptionFinal(text: string): void;
  onSpoken(text: string, interrupted: boolean): void;
  onStatus(status: string): void;
  onError(message: string): void;
}

interface Credentials {
  token: string;
  agentId: string;
}

export class RelayClient {
  private socket?: WebSocket;
  private ended?: () => void;
  sessionId: string | null = null;

  constructor(
    private credentials: Credentials,
    private handlers: RelayHandlers,
    private player: ReplyPlayer,
    private SocketImpl: typeof WebSocket = WebSocket,
  ) {}

  async connect(): Promise<void> {
    const socket = new this.SocketImpl(
      `wss://agents.assemblyai.com/v1/ws?token=${this.credentials.token}`,
    );
    this.socket = socket;

    socket.onopen = () => {
      // agent_id must be FIRST and ALONE. Any inline field beside it raises
      // agent_id_not_first and the session dies.
      this.send({ type: "session.update", session: { agent_id: this.credentials.agentId } });
    };

    socket.onmessage = (event: MessageEvent<string>) => this.handle(JSON.parse(event.data));

    socket.onclose = (event: CloseEvent) => {
      // In browsers a pre-handshake failure is close code 1006 with no payload.
      if (event.code === 1006) this.handlers.onError("Could not connect. Try again.");
      this.handlers.onStatus("disconnected");
    };
  }

  private send(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  private handle(message: any): void {
    switch (message.type) {
      case "session.ready":
        this.sessionId = message.session_id;
        this.handlers.onStatus("connected");
        break;
      case "input.speech.started":
        // Snappiest barge-in: stop our own audio the moment they start talking.
        this.player.flush();
        break;
      case "transcript.user.delta":
        // text is the FULL transcript so far for this item. Replace it.
        this.handlers.onCaption(message.text);
        break;
      case "transcript.user":
        this.handlers.onCaptionFinal(message.text);
        break;
      case "reply.audio":
        // `data`, not `audio`. The field names are asymmetric.
        this.player.enqueue(message.data);
        break;
      case "transcript.agent":
        this.handlers.onSpoken(message.text, Boolean(message.interrupted));
        break;
      case "reply.done":
        if (message.status === "interrupted") this.player.flush();
        break;
      case "session.error":
        this.handlers.onError(`${message.code}: ${message.message}`);
        break;
      case "session.ended":
        this.ended?.();
        break;
    }
  }

  /** Streams one base64 PCM16 chunk. No-op before session.ready — early audio is discarded. */
  sendAudio(base64: string): void {
    if (!this.sessionId) return;
    this.send({ type: "input.audio", audio: base64 });
  }

  /**
   * Returns the utterance id the caller should hand to the ledger.
   *
   * ONE message, not two. The text rides on `reply.create` itself and arrives
   * as the last `messages` entry of that reply's request body, byte-identical
   * and one-shot (measured 2026-09-23, spec §3.1). That is what removes the
   * queue: there is no window in which a second utterance can overwrite a
   * first. Do not reintroduce `conversation.message` — it never reaches a
   * custom LLM's request body at all.
   */
  say(text: string, mode: RelayMode): string {
    const id = crypto.randomUUID();
    this.send({ type: "reply.create", instructions: encodeOutbound(mode, text) });
    return id;
  }

  /**
   * session.end, then WAIT for session.ended. Closing the socket bare leaves a
   * 30-second resume window open — and it is billable.
   */
  async hangUp(): Promise<void> {
    if (!this.socket) return;
    const done = new Promise<void>((resolve) => {
      this.ended = resolve;
      setTimeout(resolve, 3000); // never hang the UI on a silent server
    });
    this.send({ type: "session.end" });
    await done;
    this.player.close();
    this.socket.close();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/relay-client.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/relay-client.ts lib/relay-client.test.ts
git commit -m "feat: relay websocket client with inverted roles and correct teardown"
```

---

### Task 10: The screen

One screen: captions on the left, composer and ledger on the right, status across the top.

**Files:**
- Create: `app/components/CaptionPane.tsx`, `app/components/Composer.tsx`, `app/components/Ledger.tsx`, `app/components/StatusBar.tsx`
- Modify: `app/page.tsx`
- Test: `app/components/Ledger.test.tsx`

**Interfaces:**
- Consumes: `Utterance`, `verbatimCount` from `lib/ledger.ts`; `RelayClient`; `MicCapture`; `ReplyPlayer`.
- Produces: the rendered application.

- [ ] **Step 1: Write the failing test for the ledger view**

```tsx
// app/components/Ledger.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ledger } from "./Ledger";
import type { Utterance } from "@/lib/ledger";

const u = (over: Partial<Utterance>): Utterance => ({
  id: "1",
  typedText: "hello",
  spokenText: "hello",
  mode: "verbatim",
  status: "match",
  ...over,
});

describe("Ledger", () => {
  it("shows the running verbatim count", () => {
    render(<Ledger utterances={[u({}), u({ id: "2" })]} />);
    expect(screen.getByText(/2 of 2 relayed verbatim/i)).toBeDefined();
  });

  it("shows a mismatch as a mismatch and prints both texts", () => {
    render(
      <Ledger utterances={[u({ status: "mismatch", typedText: "make appointment", spokenText: "I'd like to make an appointment." })]} />,
    );
    expect(screen.getByText(/altered/i)).toBeDefined();
    expect(screen.getByText("make appointment")).toBeDefined();
    expect(screen.getByText("I'd like to make an appointment.")).toBeDefined();
  });

  it("marks assistant-mode lines and excludes them from the count", () => {
    render(<Ledger utterances={[u({}), u({ id: "2", mode: "assistant" })]} />);
    expect(screen.getByText(/1 of 1 relayed verbatim/i)).toBeDefined();
    expect(screen.getByText(/assistant/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- app/components/Ledger.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ledger view**

```tsx
// app/components/Ledger.tsx
"use client";
import { verbatimCount, type Utterance } from "@/lib/ledger";

const LABEL: Record<Utterance["status"], string> = {
  pending: "speaking…",
  match: "spoken verbatim",
  mismatch: "altered",
  interrupted: "interrupted",
};

export function Ledger({ utterances }: { utterances: Utterance[] }) {
  const { matched, total } = verbatimCount(utterances);

  return (
    <section aria-label="Verbatim ledger" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">
        {matched} of {total} relayed verbatim
      </h2>

      <ol className="flex flex-col gap-2">
        {utterances.map((u) => (
          <li key={u.id} className="rounded-lg border border-slate-700 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-400">you typed</span>
              <span className={u.status === "mismatch" ? "text-amber-400" : "text-slate-400"}>
                {LABEL[u.status]}
                {u.mode === "assistant" ? " · assistant" : ""}
              </span>
            </div>
            <p className="text-slate-100">{u.typedText}</p>
            {u.spokenText !== null && u.status !== "match" && (
              <>
                <span className="text-slate-400">actually spoken</span>
                <p className="text-amber-200">{u.spokenText}</p>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- app/components/Ledger.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement the caption pane**

```tsx
// app/components/CaptionPane.tsx
"use client";

export function CaptionPane({ finals, partial }: { finals: string[]; partial: string }) {
  return (
    <section aria-label="Live captions" aria-live="polite" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">They said</h2>
      {finals.map((line, i) => (
        <p key={i} className="text-lg text-slate-100">
          {line}
        </p>
      ))}
      {partial && <p className="text-lg text-slate-400">{partial}</p>}
    </section>
  );
}
```

- [ ] **Step 6: Implement the composer with quick phrases**

```tsx
// app/components/Composer.tsx
"use client";
import { useState } from "react";
import type { RelayMode } from "@/lib/sentinel";

const QUICK = [
  "I'm using a relay service — please speak normally.",
  "Please repeat that.",
  "Please hold on.",
  "Yes.",
  "No.",
];

export function Composer({
  onSend,
  mode,
  onModeChange,
  disabled,
}: {
  onSend: (text: string, mode: RelayMode) => void;
  mode: RelayMode;
  onModeChange: (mode: RelayMode) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");

  function send(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed, mode);
    setText("");
  }

  return (
    <section aria-label="Compose" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((phrase) => (
          <button
            key={phrase}
            type="button"
            disabled={disabled}
            onClick={() => send(phrase)}
            className="rounded-full border border-slate-600 px-3 py-1 text-sm text-slate-200"
          >
            {phrase}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(text);
          }
        }}
        aria-label="Type what you want said"
        placeholder="Type here. Enter speaks it."
        className="min-h-24 rounded-lg border border-slate-600 bg-slate-900 p-3 text-lg text-slate-100"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === "assistant"}
          disabled={disabled}
          onChange={(e) => onModeChange(e.target.checked ? "assistant" : "verbatim")}
        />
        <span className={mode === "assistant" ? "font-semibold text-amber-300" : "text-slate-300"}>
          {mode === "assistant"
            ? "ASSISTANT IS SPEAKING — it handles menus and hold, and never answers for you"
            : "Assistant mode (menus and hold only) — off"}
        </span>
      </label>
    </section>
  );
}
```

- [ ] **Step 7: Implement the status bar**

```tsx
// app/components/StatusBar.tsx
"use client";

export function StatusBar({
  status,
  deletion,
  error,
}: {
  status: string;
  deletion: string | null;
  error: string | null;
}) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-slate-700 pb-3">
      <span className="text-xl font-semibold text-slate-50">Aloud</span>
      <span className="text-sm text-slate-400">{status}</span>
      {deletion && <span className="text-sm text-emerald-400">{deletion}</span>}
      {error && <span className="text-sm text-rose-400">{error}</span>}
    </header>
  );
}
```

- [ ] **Step 8: Wire the page**

```tsx
// app/page.tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptionPane } from "./components/CaptionPane";
import { Composer } from "./components/Composer";
import { Ledger } from "./components/Ledger";
import { StatusBar } from "./components/StatusBar";
import { MicCapture } from "@/lib/audio/capture";
import { ReplyPlayer } from "@/lib/audio/playback";
import { RelayClient } from "@/lib/relay-client";
import { ledgerReducer, type LedgerEvent, type Utterance } from "@/lib/ledger";
import type { RelayMode } from "@/lib/sentinel";

export default function Page() {
  const [status, setStatus] = useState("not connected");
  const [error, setError] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<string | null>(null);
  const [finals, setFinals] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [mode, setMode] = useState<RelayMode>("verbatim");
  const [live, setLive] = useState(false);

  const client = useRef<RelayClient | null>(null);
  const capture = useRef<MicCapture | null>(null);

  const push = useCallback((event: LedgerEvent) => {
    setUtterances((state) => ledgerReducer(state, event));
  }, []);

  async function startCall() {
    setError(null);
    const response = await fetch("/api/call", { method: "POST" });
    if (!response.ok) {
      setError((await response.json()).error ?? "Could not start the call");
      return;
    }
    const { token, agentId } = await response.json();

    // NEVER pass sampleRate here. Firefox loses echo cancellation; Safari garbles.
    const ctx = new AudioContext();
    await ctx.resume();

    const player = new ReplyPlayer(ctx);
    const relay = new RelayClient({ token, agentId }, {
      onCaption: setPartial,
      onCaptionFinal: (text) => {
        setFinals((f) => [...f, text]);
        setPartial("");
      },
      onSpoken: (text, interrupted) => push({ type: "spoken", text, interrupted }),
      onStatus: setStatus,
      onError: setError,
    }, player);

    await relay.connect();
    client.current = relay;

    const mic = new MicCapture(ctx);
    // sendAudio is a no-op before session.ready — audio sent earlier is discarded.
    await mic.start((audio) => relay.sendAudio(audio));
    capture.current = mic;
    setLive(true);
  }

  async function hangUp() {
    const relay = client.current;
    capture.current?.stop();
    await relay?.hangUp();
    setLive(false);

    if (relay?.sessionId) {
      const response = await fetch("/api/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: relay.sessionId }),
      });
      const result = await response.json();
      setDeletion(
        result.deleted
          ? `Recording deleted — ${relay.sessionId} at ${new Date(result.at).toLocaleTimeString()}`
          : `Could not confirm deletion. Session ${relay.sessionId} may still be retained.`,
      );
    }
  }

  useEffect(() => {
    const onHide = () => {
      // Nothing async survives a closing tab; sendBeacon does.
      const id = client.current?.sessionId;
      if (id) navigator.sendBeacon("/api/end", JSON.stringify({ sessionId: id }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <StatusBar status={status} deletion={deletion} error={error} />

      {!live ? (
        <button
          onClick={startCall}
          className="self-start rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-900"
        >
          Start a call
        </button>
      ) : (
        <button
          onClick={hangUp}
          className="self-start rounded-lg bg-rose-500 px-5 py-3 font-semibold text-slate-50"
        >
          Hang up and delete the recording
        </button>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <CaptionPane finals={finals} partial={partial} />
        <div className="flex flex-col gap-6">
          <Composer
            disabled={!live}
            mode={mode}
            onModeChange={setMode}
            onSend={(text, sendMode) => {
              const id = client.current!.say(text, sendMode);
              push({ type: "typed", id, text, mode: sendMode });
            }}
          />
          <Ledger utterances={utterances} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all tests.

```bash
git add app lib/relay-client.ts
git commit -m "feat: the relay screen — captions, composer, ledger, status"
```

---

### Task 11: Deletion on hangup

**Files:**
- Create: `app/api/end/route.ts`
- Test: `app/api/end/route.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `POST /api/end` accepting `{ sessionId: string }` and responding `{ deleted: boolean; at: string; sessionId: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/end/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const request = (body: unknown) =>
  new Request("https://example.com/api/end", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  process.env.ASSEMBLYAI_API_KEY = "key";
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/end", () => {
  it("DELETEs the session and reports success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(request({ sessionId: "sess_1" }));
    expect(await res.json()).toMatchObject({ deleted: true, sessionId: "sess_1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://agents.assemblyai.com/v1/sessions/sess_1");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("retries a transient failure before giving up", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await (await POST(request({ sessionId: "sess_2" }))).json()).toMatchObject({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports failure honestly rather than claiming deletion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    const res = await POST(request({ sessionId: "sess_3" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ deleted: false, sessionId: "sess_3" });
  });

  it("rejects a request without a session id", async () => {
    expect((await POST(request({}))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- app/api/end/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// app/api/end/route.ts
export const dynamic = "force-dynamic";

const ATTEMPTS = [0, 500, 1500, 3000, 5000]; // ~10s total, per spec §5.3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return Response.json({ error: "not configured" }, { status: 500 });

  const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });

  let lastStatus = 0;
  for (const wait of ATTEMPTS) {
    if (wait) await sleep(wait);
    const response = await fetch(`https://agents.assemblyai.com/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    lastStatus = response.status;
    // 204 = soft-deleted: it leaves GET /v1/sessions and its artifacts stop resolving.
    if (response.status === 204) {
      return Response.json({ deleted: true, sessionId, at: new Date().toISOString() });
    }
    // A 404 will not become a 204. Stop retrying.
    if (response.status === 404) break;
  }

  return Response.json({ deleted: false, sessionId, status: lastStatus }, { status: 502 });
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- app/api/end/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify by hand on the deployment**

Place a real call, hang up, and confirm the banner reads "Recording deleted — sess_… at …". Then:

```bash
curl -s "https://agents.assemblyai.com/v1/sessions/<id>" -H "Authorization: Bearer $ASSEMBLYAI_API_KEY"
```

Expected: the session no longer resolves, or resolves without usable artifacts.

- [ ] **Step 6: Commit**

```bash
git add app/api/end
git commit -m "feat: delete the provider recording on hangup, and say so honestly"
```

---

### Task 12: Cross-browser hardening and the measured latency number

**Files:**
- Modify: `app/page.tsx`, `lib/relay-client.ts`
- Create: `docs/BROWSER-NOTES.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a verified matrix in `docs/BROWSER-NOTES.md`, and a median `time_to_first_audio_ms` in the README.

- [ ] **Step 1: Run the same call in Chrome, Firefox and Safari**

For each: start a call, hear the greeting, type a sentence, hear it spoken, see the ledger match, speak into the mic and see captions, talk over the TTS and confirm the audio **stops**, hang up, see the deletion confirmed.

Record each result in `docs/BROWSER-NOTES.md` with the browser version.

- [ ] **Step 2: Fix the two failures this always finds**

If the agent interrupts itself on Firefox, an `AudioContext` is being constructed with an explicit `sampleRate` somewhere. Grep for it:

Run: `grep -rn "sampleRate" app lib public`
Expected: `sampleRate` appears only in `public/pcm-processor.js` (as `processorOptions`) and in `lib/audio/capture.ts` (reading `ctx.sampleRate`). Anywhere else is the bug.

If Safari plays nothing, confirm `await audioCtx.resume()` runs inside the click handler, not after an `await fetch`.

- [ ] **Step 3: Add the session-expiry warning**

In `app/page.tsx`, after `startCall` succeeds:

```ts
    // session_expired arrives as a 1008 close with NO warning event. Run our own timer.
    const warnAt = (600 - 60) * 1000;
    const timer = setTimeout(() => setError("This call ends in 60 seconds."), warnAt);
    expiryTimer.current = timer;
```

Declare `const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);` alongside the other refs and clear it in `hangUp`.

- [ ] **Step 4: Measure latency once, from the session's own timeline**

Before deleting a test session, fetch its timeline and take the median `time_to_first_audio_ms`:

```bash
SESSION=<id>
URL=$(curl -s "https://agents.assemblyai.com/v1/sessions/$SESSION" \
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY" \
  | python3 -c "import sys,json;print(next(a['url'] for a in json.load(sys.stdin)['artifacts'] if a['type']=='timeline'))")
curl -s "$URL" | python3 -c "
import sys, json, statistics
turns = json.load(sys.stdin).get('turns', [])   # empty arrays are OMITTED — default them
values = [t['time_to_first_audio_ms'] for t in turns if 'time_to_first_audio_ms' in t]
print('median ms:', statistics.median(values) if values else 'no data')
"
```

Write the number and the date into `README.md`. **Then delete the session.** It is a real measurement or it is not quoted.

- [ ] **Step 5: Commit**

```bash
git add docs/BROWSER-NOTES.md app lib README.md
git commit -m "fix: cross-browser audio hardening, expiry warning, measured latency"
```

---

### Task 13: Submission assets

**Files:**
- Create: `docs/SUBMISSION.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the deployed app.
- Produces: every artifact on the PRD §6 checklist.

- [ ] **Step 1: Re-check the live submission form**

The format conventions in PRD §6 are general lablab conventions, not this hackathon's published rules. Open the submission form and write the **actual** limits into `docs/SUBMISSION.md` before recording anything.

- [ ] **Step 2: Re-scan the leaderboard for late accessibility entries**

```bash
curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live" -o /tmp/live.html
# The submission list is embedded as escaped JSON in the HTML; unescape \" then
# regex for {"title":…,"likes":…,"shortDescription":…}. The rendered page is useless.
```

Search the result for: deaf, hard of hearing, hearing, accessib, sign language, caption, disab, relay, nonverbal, non-speaking, AAC, speech disability. Record what you find in `docs/research/hackathon-strategy.md` §4. If someone has landed the same product, the ledger and the deletion are still differentiators — but say so honestly in the submission rather than discovering it in judging.

- [ ] **Step 3: Write the submission copy**

`docs/SUBMISSION.md` holds: title (≤50 chars), short description (≤255 chars), long description (≥100 words), tags, and the video script. The long description must name the prior art (PRD §7) — a judge who knows this market will, and being first is better.

- [ ] **Step 4: Record the video**

Structure from PRD §6. Shoot the ledger and the deletion banner in close-up; they are the argument. Include one deliberate **mismatch** if you can force one — a receipt that can fail is worth more than one that always passes.

- [ ] **Step 5: Final commit**

```bash
git add docs/SUBMISSION.md README.md docs/research/hackathon-strategy.md
git commit -m "docs: submission assets, copy, and the final leaderboard re-scan"
```

---

## Self-review

**Spec coverage.** §2 architecture → Tasks 1, 3, 4. §2.2 agent config → Task 4. §3 verbatim pass-through → Tasks 2, 3. §3.2 gates → Task 5. §3.3 ledger → Tasks 8, 10. §3.4 no-model rule → Global Constraints and Task 3 Step 7. §4.1/§4.2 modes → Tasks 2, 3, 10. §4.4 system prompt → Task 4. §5 retention → Task 11, with `pagehide` in Task 10. §5.4 latency → Task 12 Step 4. §6 data flow → Task 9. §7 browser audio → Tasks 6, 7, 12. §8 error handling → Tasks 3, 9, 11, 12. §9 testing → the test block in every task. §10 stack → Task 1. §11 open questions → PRD, not code.

**Placeholders.** None. Every code step carries the code; every run step carries the command and the expected output.

**Type consistency.** `RelayMode` is defined once in `lib/sentinel.ts` and imported by `lib/ledger.ts`, `lib/relay-client.ts` and the components. `Utterance` and `LedgerEvent` are defined once in `lib/ledger.ts`. `RelayClient.say()` returns the id the ledger uses. `ReplyPlayer` exposes exactly `enqueue`/`flush`/`close`, which is what `relay-client.test.ts` fakes. `/api/call` returns `{ token, agentId }` in Task 4 and is consumed with those names in Task 10. `/api/end` returns `{ deleted, at, sessionId }` in Task 11 and is read with those names in Task 10.

**No forward references.** Every symbol a task uses is defined in that task or an earlier one. `RelayClient.sendAudio` is defined and tested in Task 9 and consumed in Task 10; `ReplyPlayer` is defined in Task 7 and faked in Task 9's tests against exactly the three methods it exposes.
