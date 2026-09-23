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
 */
export type TurnEvent = "ready" | "they-start" | "they-stop" | "reply-start" | "reply-end" | "closed";

export interface TurnState {
  ready: boolean;
  theirs: boolean;
  ours: boolean;
}

export type TurnLabel = "connecting" | "listening" | "theirs" | "yours";

export const INITIAL_TURN: TurnState = { ready: false, theirs: false, ours: false };

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
      return { ...state, ours: true };
    case "reply-end":
      return { ...state, ours: false };
    default:
      return state;
  }
}

export function turnLabel(state: TurnState): TurnLabel {
  if (!state.ready) return "connecting";
  if (state.theirs) return "theirs"; // precedence: spec 2.1
  if (state.ours) return "yours";
  return "listening";
}
