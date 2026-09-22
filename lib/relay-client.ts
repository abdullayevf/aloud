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

  /** Closes the socket directly, without the session.end handshake — for an
   * attempt abandoned before any session became ready (e.g. a recoverable
   * agent_not_found, or a connection attempt that timed out). There is no
   * live session to end in that case. */
  closeAbandoned(): void {
    this.socket?.close();
  }
}

export interface CredentialsFetcher {
  (recreate: boolean): Promise<Credentials>;
}

export interface RecoveryOptions {
  maxAttempts?: number;
  SocketImpl?: typeof WebSocket;
}

const AGENT_NOT_FOUND = /^agent_not_found:/i;
/** Matches the 10s read-timeout budget documented elsewhere in this codebase
 * for this API: if a connection attempt hasn't resolved (ready or errored)
 * in this long, treat it as failed rather than hang the UI forever. */
const CONNECT_TIMEOUT_MS = 10_000;

class RetrySignal extends Error {
  constructor(public readonly client: RelayClient) {
    super("agent_not_found: retrying with a fresh agent");
  }
}

async function attemptConnect(
  credentials: Credentials,
  handlers: RelayHandlers,
  player: ReplyPlayer,
  SocketImpl: typeof WebSocket,
  canRetryOnAgentNotFound: boolean,
): Promise<RelayClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // `settle` closes over `timer`, declared with `const` further down (once,
    // at its only assignment, right where it's created) rather than up here
    // with `let` — safe because `settle` is never invoked until after that
    // declaration has run (it's only called from callbacks fired later, by
    // socket events or the timeout itself), so `timer` is never read during
    // its temporal dead zone.
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const client = new RelayClient(
      credentials,
      {
        ...handlers,
        onStatus: (status) => {
          handlers.onStatus(status);
          if (status === "connected") settle(() => resolve(client));
        },
        onError: (message) => {
          // Once this attempt has already settled (connected, or already
          // decided to retry/fail), every later error is a live-call error,
          // not a connection-attempt outcome — forward it, never swallow it.
          if (settled) {
            handlers.onError(message);
            return;
          }
          settle(() => {
            if (AGENT_NOT_FOUND.test(message) && canRetryOnAgentNotFound) {
              reject(new RetrySignal(client));
            } else {
              handlers.onError(message);
              reject(new Error(message));
            }
          });
        },
      },
      player,
      SocketImpl,
    );

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      settle(() => {
        client.closeAbandoned();
        const message = "Connection attempt timed out.";
        handlers.onError(message);
        reject(new Error(message));
      });
    }, CONNECT_TIMEOUT_MS);

    client.connect();
  });
}

/**
 * Connects with automatic recovery from the agent-visibility partition: a
 * stored agent created from Vercel's network has been observed invisible —
 * agent_not_found on the socket — to calls from another network for 30+
 * minutes with no convergence (docs/research/gate-results-2026-09-22.md).
 * On that specific error, re-fetch credentials with recreate:true (tokens
 * are single-use regardless, so a fresh one is required either way) and
 * reconnect, bounded by maxAttempts rather than looping forever on a dead
 * id, closing each abandoned attempt's socket so it stops billing. Any
 * other error — a bad network, a non-recoverable session.error, an attempt
 * timeout, or fetchCredentials itself throwing (e.g. a 403/429 from
 * /api/call) — propagates immediately with no retry; for a session.error
 * or a timeout, handlers.onError has already been called before the
 * rejection, but fetchCredentials throwing is a bare rejection with no
 * onError call, since there's no RelayClient/session involved yet.
 */
export async function connectWithRecovery(
  fetchCredentials: CredentialsFetcher,
  handlers: RelayHandlers,
  player: ReplyPlayer,
  { maxAttempts = 3, SocketImpl = WebSocket }: RecoveryOptions = {},
): Promise<RelayClient> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const credentials = await fetchCredentials(attempt > 1);
    try {
      return await attemptConnect(credentials, handlers, player, SocketImpl, attempt < maxAttempts);
    } catch (error) {
      if (error instanceof RetrySignal) {
        error.client.closeAbandoned(); // don't leave a dead attempt's socket billing
        continue;
      }
      throw error;
    }
  }
  throw new Error("connectWithRecovery: exhausted attempts");
}
