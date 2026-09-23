/**
 * Whose turn it is, derived from events the socket already sends.
 *
 * A hearing person knows when to speak because they hear silence. A deaf user
 * has no such cue, so this is the single largest accessibility element on the
 * screen — and it costs nothing: `input.speech.started` was already arriving
 * and being used for one thing only (flushing playback), and
 * `input.speech.stopped` was being dropped entirely.
 *
 * Kept as a pure reducer so it is tested without a socket or a browser.
 *
 * ## Why `reply.started` alone is not "your words are going out"
 *
 * The Voice Agent API takes a turn of its own after EVERY hearing-party turn,
 * whether or not we handed it anything to say — that is the documented message
 * sequence (`input.speech.stopped` → `transcript.user` → `reply.started`,
 * docs/assemblyai-integration.md), and gate G2 measured what those turns
 * contain: ~2.4 s of audio frames and zero `transcript.agent` events. Silence,
 * with a reply wrapped around it.
 *
 * So `reply.started` means "the agent is taking a turn". Mapping it straight to
 * `yours` put "Speaking your words" on screen for ~2.4 seconds after the other
 * person stopped talking, every single turn, while nothing at all was being
 * said in the user's name. On a relay that is not a cosmetic bug: the one
 * element the user cannot verify by ear was asserting that their words had gone
 * out when they had not.
 *
 * `yours` therefore needs a second fact the socket does not carry: did WE ask
 * for this reply? The browser knows — it is the ledger. A typed line sits
 * `pending` until the provider's own `transcript.agent` comes back saying what
 * was spoken, and `awaitingReceipt()` is exactly that question. A reply turn
 * with nothing outstanding is the agent's silence, not the user's voice.
 *
 * It is also self-healing, which a counter would not be: if a reply is never
 * acknowledged, `reply.done` still clears `replying` and the label falls back
 * to "Your turn" rather than sticking on a lie.
 */
export type TurnEvent = "ready" | "they-start" | "they-stop" | "reply-start" | "reply-end" | "closed";

export interface TurnState {
  ready: boolean;
  theirs: boolean;
  /** The agent is taking a turn. Deliberately NOT named `ours` — at this level
   * we do not yet know whose words, if anyone's, are in it. */
  replying: boolean;
}

export type TurnLabel = "connecting" | "listening" | "theirs" | "yours";

export const INITIAL_TURN: TurnState = { ready: false, theirs: false, replying: false };

export function turnReducer(state: TurnState, event: TurnEvent): TurnState {
  switch (event) {
    case "ready":
      return { ...state, ready: true };
    case "closed":
      return INITIAL_TURN;
    default:
      break;
  }
  // Before session.ready nothing is a turn yet: audio sent early is discarded
  // server-side, so showing a turn for it would be a lie on screen.
  if (!state.ready) return state;

  switch (event) {
    case "they-start":
      return { ...state, theirs: true };
    case "they-stop":
      return { ...state, theirs: false };
    case "reply-start":
      return { ...state, replying: true };
    case "reply-end":
      return { ...state, replying: false };
    default:
      return state;
  }
}

/**
 * `awaitingReceipt` comes from the ledger — see `awaitingReceipt()` in
 * lib/ledger.ts and the note above. Without it every hearing-party turn is
 * followed by a false "Speaking your words".
 */
export function turnLabel(state: TurnState, awaitingReceipt: boolean): TurnLabel {
  if (!state.ready) return "connecting";
  if (state.theirs) return "theirs"; // precedence: spec 2.1
  if (state.replying && awaitingReceipt) return "yours";
  return "listening";
}
