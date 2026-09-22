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
