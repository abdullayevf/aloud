import { encodeOutbound } from "./sentinel";
import type { ReplyPlayer } from "./audio/playback";
import type { TurnEvent } from "./turn-state";

export interface RelayHandlers {
  onCaption(partial: string): void;
  onCaptionFinal(text: string): void;
  onSpoken(text: string, interrupted: boolean): void;
  onStatus(status: string): void;
  onError(message: string): void;
  /** Whose turn it is. Spec 2.1 — the largest accessibility element on screen. */
  onTurn(event: TurnEvent): void;
  /** One word of the reply currently being spoken, with its offsets into that
   * reply's audio. The field is `delta`, not `text`, and these are NOT
   * cumulative — the opposite convention to transcript.user.delta. */
  onSpokenWord(replyId: string, delta: string, startMs: number, endMs: number): void;
}

interface Credentials {
  token: string;
  agentId: string;
}

type ServerMessage = { type: string } & Record<string, unknown>;

export class RelayClient {
  private socket?: WebSocket;
  private ended?: () => void;
  private greetingConsumed = false;
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
      this.handlers.onTurn("closed");
    };
  }

  private send(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case "session.ready":
        this.sessionId = message.session_id as string;
        this.handlers.onStatus("connected");
        this.handlers.onTurn("ready");
        break;
      case "input.speech.started":
        // Snappiest barge-in: stop our own audio the moment they start talking.
        this.player.flush();
        this.handlers.onTurn("they-start");
        break;
      case "input.speech.stopped":
        // Previously dropped entirely. This is the "your turn" cue.
        this.handlers.onTurn("they-stop");
        break;
      case "reply.started":
        // Marks the next enqueue() as a new reply's origin. The API takes a
        // reply turn after EVERY hearing-party turn (~2.4s of silence,
        // measured gate G2), so this fires on silent turns too — harmless,
        // since those carry no word deltas to ink against the wrong clock.
        this.player.beginReply();
        this.handlers.onTurn("reply-start");
        break;
      case "transcript.user.delta":
        // text is the FULL transcript so far for this item. Replace it.
        this.handlers.onCaption(message.text as string);
        break;
      case "transcript.user":
        this.handlers.onCaptionFinal(message.text as string);
        break;
      case "reply.audio":
        // `data`, not `audio`. The field names are asymmetric.
        this.player.enqueue(message.data as string);
        break;
      case "transcript.agent.delta":
        this.handlers.onSpokenWord(
          message.reply_id as string,
          message.delta as string,
          message.start_ms as number,
          message.end_ms as number,
        );
        break;
      case "transcript.agent":
        // The configured `greeting` is spoken automatically at session.ready,
        // entirely outside any reply.create the client sent — its
        // transcript.agent is always the FIRST one of the session, and it can
        // arrive after the user has already typed something (the composer is
        // enabled as soon as the mic starts, well before the ~10s greeting
        // finishes). A real reply's receipt can only exist after a say() call,
        // which is always later than the greeting's. Swallow the first one
        // unconditionally rather than let it steal (and permanently offset)
        // the ledger's FIFO pairing.
        if (!this.greetingConsumed) {
          this.greetingConsumed = true;
          break;
        }
        this.handlers.onSpoken(message.text as string, Boolean(message.interrupted));
        break;
      case "reply.done":
        if (message.status === "interrupted") this.player.flush();
        this.handlers.onTurn("reply-end");
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
  say(text: string): string {
    const id = crypto.randomUUID();
    this.send({ type: "reply.create", instructions: encodeOutbound(text) });
    return id;
  }

  /**
   * session.end, then WAIT for session.ended. Closing the socket bare leaves a
   * 30-second resume window open — and it is billable.
   */
  async hangUp(): Promise<void> {
    if (!this.socket) return;
    // The server can close first (session_expired is a bare 1008 with no
    // warning event). session.end into a closed socket is silently discarded,
    // so the handshake would just block for the full 3s fallback waiting for a
    // session.ended that can never arrive — and the caller's deletion POST
    // would sit behind it. Nothing to end: release and return.
    if (this.socket.readyState !== 1 /* OPEN */) {
      this.player.close();
      this.socket = undefined;
      return;
    }
    const done = new Promise<void>((resolve) => {
      this.ended = resolve;
      setTimeout(resolve, 3000); // never hang the UI on a silent server
    });
    this.send({ type: "session.end" });
    await done;
    this.player.close();
    this.socket.close();
    // Idempotent: a second hangUp() would otherwise resend session.end into an
    // already-closed socket and block for the full 3s fallback waiting for a
    // session.ended that can never arrive. The guard at the top makes it a
    // no-op once this is cleared.
    this.socket = undefined;
  }

  /** Closes the socket directly, without the session.end handshake — for an
   * attempt abandoned before any session became ready (e.g. a recoverable
   * agent_not_found, or a connection attempt that timed out). There is no
   * live session to end in that case. Handlers are detached first: close()
   * is asynchronous, and a late event from this abandoned socket must never
   * reach the handlers that, by the time it fires, may already belong to a
   * different, successfully-recovered call. */
  closeAbandoned(): void {
    if (!this.socket) return;
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onclose = null;
    this.socket.close();
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
