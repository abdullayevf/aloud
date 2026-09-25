"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallEnded } from "./components/CallEnded";
import { CallSetup } from "./components/CallSetup";
import { Composer } from "./components/Composer";
import { Timeline, type HeardLine } from "./components/Timeline";
import { TurnIndicator } from "./components/TurnIndicator";
import { MicCapture } from "@/lib/audio/capture";
import { ReplyPlayer } from "@/lib/audio/playback";
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

  const client = useRef<RelayClient | null>(null);
  const capture = useRef<MicCapture | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    let ctx: AudioContext | undefined;
    let player: ReplyPlayer | undefined;

    try {
      // NEVER pass sampleRate here. Firefox loses echo cancellation; Safari garbles.
      ctx = new AudioContext();
      await ctx.resume();
      audioCtx.current = ctx;
      player = new ReplyPlayer(ctx);

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
            onTurn: (event: TurnEvent) => setTurn((t) => turnReducer(t, event)),
            // Task 7 gives this a body: it will drive the word-by-word ink
            // in the reply timeline. Wiring it here would duplicate that
            // task's work, so it's a required no-op until then.
            onSpokenWord: () => {},
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
        setError(err instanceof Error ? err.message : "Could not access the microphone");
      }
    } catch (err) {
      // new AudioContext() / ctx.resume() itself failed (construction limit,
      // no audio hardware, a rejected resume()) before any connection was
      // attempted — nothing to hang up, just release whatever was created.
      player?.close();
      ctx?.close();
      audioCtx.current = null;
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
        <span className="text-sm text-mute">{status}</span>
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
            {/* The second argument is the whole correction: a reply turn the API
              * started on its own is not the user's voice. lib/turn-state.ts. */}
            <TurnIndicator label={turnLabel(turn, awaitingReceipt(utterances))} />
            <p className="text-sm tabular-nums text-dim">
              {total === 0 ? "Nothing spoken yet" : `${matched} of ${total} spoken exactly`}
            </p>
          </div>

          <Timeline heard={heard} utterances={utterances} partial={partial} />

          <Composer
            value={draft}
            onChange={setDraft}
            disabled={!live}
            continuation={continuation}
            onContinuationUsed={onContinuationUsed}
            onSend={(text) => {
              const id = client.current!.say(text);
              seq.current += 1;
              push({ type: "typed", id, seq: seq.current, text });
            }}
          />

          <button
            onClick={hangUp}
            className="self-start rounded-lg border border-danger px-5 py-2.5 font-bold text-danger hover:bg-danger hover:text-paper"
          >
            Hang up and delete the recording
          </button>
        </>
      )}
    </main>
  );
}
