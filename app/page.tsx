"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallEnded } from "./components/CallEnded";
import { CallSetup } from "./components/CallSetup";
import { Composer } from "./components/Composer";
import { Timeline, type HeardLine, type InkState } from "./components/Timeline";
import { TurnIndicator } from "./components/TurnIndicator";
import { MicCapture } from "@/lib/audio/capture";
import { ReplyPlayer } from "@/lib/audio/playback";
import { appendWord, inkWords, type ReplyTimeline } from "@/lib/caption-timeline";
import { connectWithRecovery, type CredentialsFetcher, type RelayClient } from "@/lib/relay-client";
import {
  awaitingReceipt,
  ledgerReducer,
  verbatimCount,
  type LedgerEvent,
  type Utterance,
} from "@/lib/ledger";
import { INITIAL_TURN, turnLabel, turnReducer, type TurnEvent } from "@/lib/turn-state";

export default function Page() {
  const [status, setStatus] = useState("not connected");
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a scheduled warning is not a failure, and the two
  // would otherwise silently overwrite each other in the same slot.
  const [notice, setNotice] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<string | null>(null);
  const [heard, setHeard] = useState<HeardLine[]>([]);
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState(INITIAL_TURN);
  const [ended, setEnded] = useState(false);
  const [partial, setPartial] = useState("");
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // The id of the interrupted row whose remainder has already been offered to
  // the composer, so it is not offered again — see `continuation` below.
  const [consumedRemainderId, setConsumedRemainderId] = useState<string | null>(null);
  // The live word split of the in-flight reply against the playback clock —
  // see the effect below. State, not a ref: it is what the timeline actually
  // renders, but setInk is identity-guarded so an unchanged split does not
  // force a re-render. The guard is what makes this affordable: the split only
  // changes when the voice crosses into the next word, two to four times a
  // second, not on every one of the 60 frames that sample it.
  const [ink, setInk] = useState<InkState | null>(null);

  const client = useRef<RelayClient | null>(null);
  const capture = useRef<MicCapture | null>(null);
  // Holds the same ReplyPlayer instance startCall() constructs, so the ink
  // effect below can read elapsedMs() without a prop of its own threading a
  // per-frame value through render.
  const playerRef = useRef<ReplyPlayer | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Not React state: the transcript.agent.delta burst lands ~18 words inside
  // 4ms, and this is read by a render loop (the ink effect below), never by
  // reconciliation.
  const timeline = useRef<ReplyTimeline | null>(null);
  // The last playback position the ink effect actually saw. A barge-in nulls
  // the player's reply origin, so at the instant we need to freeze the stroke
  // there is no clock left to ask — this is the only record of where the voice
  // had got to, and it is what decides how far across the word the frozen
  // stroke sits.
  const lastElapsed = useRef(0);
  // hangUp() only closes the player and the socket — without a handle on the
  // AudioContext itself it leaks one per successful call, and Chrome caps a
  // document at 6.
  const audioCtx = useRef<AudioContext | null>(null);
  // onStatus("disconnected") fires both for an unexpected drop (session_expired
  // arrives with no warning event at all) and at the end of a deliberate
  // hangUp(). Only the first of those deserves an error on screen.
  const intentionalHangup = useRef(false);
  // One monotonic counter across BOTH sides, so the timeline is a single
  // column in real order rather than two lists stitched together. A ref, not
  // state: it must increment inside an event handler without a render first.
  const seq = useRef(0);

  const push = useCallback((event: LedgerEvent) => {
    setUtterances((state) => ledgerReducer(state, event));
  }, []);

  async function startCall() {
    if (connecting || live) return; // no second connection attempt while one is in flight
    intentionalHangup.current = false;
    setConnecting(true);
    setError(null);
    setNotice(null);
    setEnded(false);
    setDeletion(null);
    setHeard([]);
    setUtterances([]);
    setPartial("");
    setDraft("");
    setConsumedRemainderId(null);
    setTurn(INITIAL_TURN);
    seq.current = 0;
    // A stale timeline bleeding from the previous call into a new one is a
    // real defect: a word could ink against another call's clock.
    timeline.current = null;
    lastElapsed.current = 0;
    setInk(null);

    let ctx: AudioContext | undefined;
    let player: ReplyPlayer | undefined;

    try {
      // NEVER pass sampleRate here. Firefox loses echo cancellation; Safari garbles.
      ctx = new AudioContext();
      await ctx.resume();
      audioCtx.current = ctx;
      player = new ReplyPlayer(ctx);
      // The ink effect reads elapsedMs() off this same instance every
      // animation frame; it needs it in a ref, not threaded through props.
      playerRef.current = player;

      const fetchCredentials: CredentialsFetcher = async (recreate) => {
        const response = await fetch("/api/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recreate ? { recreate: true } : {}),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(typeof body.error === "string" ? body.error : "Could not start the call");
        }
        return response.json();
      };

      let relay: RelayClient;
      try {
        relay = await connectWithRecovery(
          fetchCredentials,
          {
            onCaption: setPartial,
            onCaptionFinal: (text) => {
              seq.current += 1;
              setHeard((h) => [...h, { id: crypto.randomUUID(), seq: seq.current, text }]);
              setPartial("");
            },
            onSpoken: (text, interrupted) => {
              // The remainder is computed inside ledgerReducer now. It cannot
              // be done out here: this runs in the same tick as push(), and
              // whichever order the two updaters queue in, one of them reads
              // state the other has already changed.
              push({ type: "spoken", text, interrupted });
            },
            onTurn: (event: TurnEvent) => {
              // reply.started fires before this reply's own deltas land
              // (~365ms, measured) but AFTER player.beginReply() has
              // already made elapsedMs() non-null against the NEW reply's
              // clock. Without clearing here, inkSplit would keep reading
              // the previous reply's words during that window and ink them
              // onto the new pending row — see caption-timeline.ts.
              // The onSend handler below clears it too, for the window
              // between one reply ending and the next reply.started arriving.
              if (event === "reply-start") timeline.current = null;
              setTurn((t) => turnReducer(t, event));
            },
            // Held in a ref, not state: transcript.agent.delta lands as
            // ~18 words inside a 4ms burst. The ink effect below samples
            // this timeline against the playback clock once per animation
            // frame instead of once per delta.
            onSpokenWord: (replyId, delta, startMs, endMs) => {
              timeline.current = appendWord(timeline.current, replyId, delta, startMs, endMs);
            },
            onStatus: (status) => {
              setStatus(status);
              // session_expired closes the socket with no warning event first.
              // Without this the composer stays enabled and say() sends into a
              // closed socket — a silent no-op — so every further line the user
              // types sits at "speaking…" forever with no sign anything is wrong.
              if (status === "disconnected" && !intentionalHangup.current) {
                setError("The call ended unexpectedly.");
                // Run the real teardown, not just setLive(false): the mic stays
                // hot, the AudioContext leaks, and — the one that matters — the
                // provider's recording is never deleted, because only hangUp()
                // POSTs /api/end with this session's id. Hitting the 600-second
                // cap is a routine way for a call to end, not a rare one.
                void hangUp();
              }
            },
            onError: setError,
          },
          player,
        );
      } catch (err) {
        // Nothing connected — don't leak the context/player this attempt created.
        player.close();
        ctx.close();
        audioCtx.current = null;
        playerRef.current = null;
        setError(err instanceof Error ? err.message : "Could not start the call");
        return;
      }
      client.current = relay;

      try {
        const mic = new MicCapture(ctx);
        // sendAudio is a no-op before session.ready — audio sent earlier is discarded.
        await mic.start((audio) => relay.sendAudio(audio));
        capture.current = mic;
        setLive(true);

        // session_expired arrives as a 1008 close with NO warning event. Run our own timer.
        const warnAt = (600 - 60) * 1000;
        expiryTimer.current = setTimeout(() => setNotice("This call ends in 60 seconds."), warnAt);
      } catch (err) {
        // The socket connected but the mic failed (e.g. permission denied) —
        // don't leave a live, billing session with no way to hang it up, and
        // don't leak the AudioContext either (hangUp only closes the player).
        client.current = null;
        await relay.hangUp();
        ctx.close();
        audioCtx.current = null;
        playerRef.current = null;
        setError(err instanceof Error ? err.message : "Could not access the microphone");
      }
    } catch (err) {
      // new AudioContext() / ctx.resume() itself failed (construction limit,
      // no audio hardware, a rejected resume()) before any connection was
      // attempted — nothing to hang up, just release whatever was created.
      player?.close();
      ctx?.close();
      audioCtx.current = null;
      playerRef.current = null;
      setError(err instanceof Error ? err.message : "Could not start audio for the call");
    } finally {
      // Unconditionally guaranteed, whichever of the paths above ran (or none did).
      setConnecting(false);
    }
  }

  async function hangUp() {
    // Before anything else: the socket close at the end of relay.hangUp() will
    // report "disconnected", and that one is expected, not a failure.
    intentionalHangup.current = true;

    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
    setNotice(null);

    const relay = client.current;
    capture.current?.stop();
    await relay?.hangUp();
    await audioCtx.current?.close();
    audioCtx.current = null;
    playerRef.current = null;
    setLive(false);
    setEnded(true);
    setTurn(INITIAL_TURN);

    if (relay?.sessionId) {
      // An offline browser, or a platform error with a non-JSON body, throws
      // here. Falling through to the same honest fallback the deleted:false
      // case uses beats ending the call with no deletion statement at all.
      try {
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
      } catch {
        setDeletion(`Could not confirm deletion. Session ${relay.sessionId} may still be retained.`);
      }
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

  // Drives `ink` from the playback clock, once per animation frame — never
  // from the delta burst itself, which lands ~18 words inside 4ms and would
  // set state far faster than React (or a human) can usefully consume it.
  //
  // Sampling at 60Hz does not mean re-rendering at 60Hz. The guards below let
  // state through only when the voice crosses into a different word, so the
  // timeline re-renders two to four times a second. Everything between those
  // handovers — the stroke travelling across the current word — is a CSS
  // animation the compositor runs on its own, which is both smoother than
  // React could be and free while the same machine is doing live audio.
  // `currentElapsedMs` is deliberately NOT in the guard: it changes every
  // frame, it is read exactly once when a word becomes current (to start the
  // stroke part-drawn), and including it would put the re-render back to 60Hz.
  useEffect(() => {
    if (!live) return;
    // globals.css's reduced-motion block stops the stroke, but not this: the
    // words themselves change colour as the voice crosses them, and that is
    // React re-rendering text, not a rule a media query can switch off. A
    // reader who asked for no motion gets the plain typed line and the
    // receipt, which carry the same facts without anything moving.
    //
    // Read once per effect run — a preference does not change frame to frame,
    // and matchMedia is absent in some test environments, hence the optional
    // calls.
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    let frame = 0;
    const tick = () => {
      const activePlayer = playerRef.current;
      const pending = utterances.find((u) => u.status === "pending");
      const elapsed = activePlayer?.elapsedMs() ?? null;
      if (elapsed !== null) lastElapsed.current = elapsed;

      // Hold whatever this row already has, or clear. The distinction that
      // matters is `prev.id === row.id`: ink this row earned from its own
      // reply, versus no ink at all. A row that has never inked stays null and
      // Timeline falls back to the plain typedText, which is the correct
      // rendering both before the first delta burst and under reduced motion.
      const holdOrClear = (row: Utterance) =>
        setInk((prev) => (prev && prev.id === row.id ? prev : null));

      // Freeze the stroke where the voice stopped, and mark it frozen so the
      // CSS animation does not carry it on to the end of a word that was never
      // finished. Idempotent: once frozen, nothing here re-sets state.
      const freeze = (row: Utterance) =>
        setInk((prev) => {
          if (!prev || prev.id !== row.id) return null;
          if (prev.frozen) return prev;
          return {
            ...prev,
            frozen: true,
            currentElapsedMs: Math.max(0, lastElapsed.current - prev.currentStartMs),
          };
        });

      if (reducedMotion) {
        // Never animate. The pending row renders its plain typed text; settled
        // rows do not use `ink` at all and are untouched.
        setInk((prev) => (prev === null ? prev : null));
      } else if (!pending) {
        setInk((prev) => (prev === null ? prev : null));
      } else if (elapsed === null) {
        // Barge-in. flush() stops the scheduled audio and nulls the player's
        // reply origin, so elapsedMs() goes null mid-sentence — correct, and
        // playback.test.ts locks it. What was wrong was the consequence here:
        // clearing `ink` sent Timeline to its fallback, which renders the
        // ENTIRE typed line in the solid already-spoken treatment. At the one
        // moment the user was cut off, the screen claimed every word got out.
        // Spec §5/§6 say the ink freezes at the word being spoken, so freeze:
        // keep the last split this row earned, and stop the stroke inside the
        // word it had reached. It clears on its own when the row settles
        // (`pending` moves on), when a new line is sent (below), and when a
        // new call starts.
        freeze(pending);
      } else {
        const split = inkWords(timeline.current, elapsed);
        // No words means no timeline for this row yet (cleared on reply-start,
        // not yet refilled by this reply's own deltas) — not "the reply is an
        // empty string". A row that has not inked yet falls through to `null`,
        // because Timeline's fallback to the plain typedText only fires when
        // `ink` is null, and an inked object with no words would render a
        // blank row for the ~365ms before the deltas arrive. A row that HAS
        // inked holds what it has instead of snapping back to the full solid
        // line.
        if (split.words.length === 0) {
          holdOrClear(pending);
        } else {
          setInk((prev) =>
            prev &&
            prev.id === pending.id &&
            !prev.frozen &&
            prev.currentIndex === split.currentIndex &&
            prev.saidCount === split.saidCount &&
            prev.words.length === split.words.length
              ? prev
              : { ...split, id: pending.id, frozen: false },
          );
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, utterances]);

  const { matched, total } = verbatimCount(utterances);

  // The most recent interrupted row with something left over, unless its
  // remainder has already been dropped into the box once. `remainder` lives
  // permanently on the row (the ledger is never rewritten), so "already
  // offered" has to be tracked separately, by id, or the same tail would come
  // back on every render after the user cleared or sent it.
  const lastInterrupted = [...utterances]
    .reverse()
    .find((u) => u.status === "interrupted" && u.remainder !== null);
  const continuation =
    lastInterrupted && lastInterrupted.id !== consumedRemainderId ? lastInterrupted.remainder : null;
  const onContinuationUsed = useCallback(() => {
    if (lastInterrupted) setConsumedRemainderId(lastInterrupted.id);
  }, [lastInterrupted]);

  return (
    // Live, this is a console with fixed chrome and exactly one scrolling
    // region — the timeline. It is the whole fix for the turn indicator
    // disappearing off the top of a long call: the element a deaf user depends
    // on most cannot be allowed to scroll away from them.
    <main
      className={`mx-auto flex w-full max-w-3xl flex-col gap-5 p-6 ${
        live ? "h-dvh" : "min-h-dvh"
      }`}
    >
      {/* One rule under the fixed chrome, not two: live, the turn bar carries
        * it, so the header drops its own rather than stack a second line 60px
        * above it. */}
      <header
        className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${
          live ? "" : "border-b border-line pb-4"
        }`}
      >
        <span className="text-2xl font-bold tracking-tight text-ink">Aloud</span>
        <div className="flex items-baseline gap-4">
          <span className="text-sm text-mute">{status}</span>
          {live && (
            // Moved out of the bottom of the live block: the ~44px plus the
            // 20px gap around it belongs to the transcript, the one region
            // on screen that actually grows with the call.
            <button
              onClick={hangUp}
              className="rounded border border-danger px-2 py-1 text-sm font-bold text-danger hover:bg-danger hover:text-paper"
            >
              Hang up and delete the recording
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-danger px-4 py-3 text-danger">{error}</p>
      )}
      {notice && (
        <p className="rounded-lg border border-altered px-4 py-3 text-altered">{notice}</p>
      )}

      {!live && !ended && <CallSetup onStart={startCall} connecting={connecting} />}

      {ended && (
        <CallEnded
          deletion={deletion}
          matched={matched}
          total={total}
          onRestart={startCall}
        />
      )}

      {live && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line pb-3">
            {/* The second argument is the whole correction: a reply turn the
              * API started on its own is not the user's voice. lib/turn-state.ts. */}
            <TurnIndicator label={turnLabel(turn, awaitingReceipt(utterances))} />
            <p className="text-sm tabular-nums text-dim">
              {total === 0 ? "Nothing spoken yet" : `${matched} of ${total} spoken exactly`}
            </p>
          </div>

          <Timeline heard={heard} utterances={utterances} partial={partial} ink={ink} />

          <Composer
            value={draft}
            onChange={setDraft}
            disabled={!live}
            continuation={continuation}
            onContinuationUsed={onContinuationUsed}
            onSend={(text) => {
              const id = client.current!.say(text);
              seq.current += 1;
              // Before the row exists, not after. `timeline.current` was only
              // ever cleared on "reply-start", and this reply's reply.started
              // is at least a network round trip away (238-377ms measured) —
              // longer still if the previous reply is mid-sentence, since the
              // API takes its next turn only after the hearing party stops.
              // For that whole window the ink effect above finds this NEW row
              // `pending` (the previous one having settled) with the OLD
              // reply's word table still loaded, and with the old clock past
              // its last word the split is
              // { spoken: <the entire previous sentence>, unspoken: "" } —
              // not the empty-halves case the effect guards. The new row would
              // render the previous line's words, in the solid "already
              // spoken" ink, as a statement about what is being said in the
              // user's name right now. Clearing both here makes a stale table
              // unreachable from a row it does not belong to.
              //
              // This clear is the ONLY guard against that. `inkSplit` takes an
              // optional `expectedReplyId` and the unit tests exercise it, but
              // no call site passes one and none can as things stand: an
              // utterance is keyed by a local `crypto.randomUUID()`, not by the
              // provider's `reply_id`, so there is nothing here to compare.
              timeline.current = null;
              // Ink is keyed by row id and Timeline renders it only when
              // `ink.id === u.id`, so ink left over from another row cannot
              // leak onto this one. What must not be dropped is a frozen
              // barge-in split on a row that has not settled yet: nulling it
              // sends that row back to Timeline's fallback, which renders the
              // whole cut-off line as if every word of it had been spoken.
              setInk((prev) =>
                prev && utterances.some((u) => u.id === prev.id && u.status === "pending")
                  ? prev
                  : null,
              );
              push({ type: "typed", id, seq: seq.current, text });
            }}
          />
        </>
      )}
    </main>
  );
}
