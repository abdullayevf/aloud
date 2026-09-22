"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptionPane } from "./components/CaptionPane";
import { Composer } from "./components/Composer";
import { Ledger } from "./components/Ledger";
import { StatusBar } from "./components/StatusBar";
import { MicCapture } from "@/lib/audio/capture";
import { ReplyPlayer } from "@/lib/audio/playback";
import { connectWithRecovery, type CredentialsFetcher, type RelayClient } from "@/lib/relay-client";
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
  const [connecting, setConnecting] = useState(false);

  const client = useRef<RelayClient | null>(null);
  const capture = useRef<MicCapture | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((event: LedgerEvent) => {
    setUtterances((state) => ledgerReducer(state, event));
  }, []);

  async function startCall() {
    if (connecting || live) return; // no second connection attempt while one is in flight
    setConnecting(true);
    setError(null);

    let ctx: AudioContext | undefined;
    let player: ReplyPlayer | undefined;

    try {
      // NEVER pass sampleRate here. Firefox loses echo cancellation; Safari garbles.
      ctx = new AudioContext();
      await ctx.resume();
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
              setFinals((f) => [...f, text]);
              setPartial("");
            },
            onSpoken: (text, interrupted) => push({ type: "spoken", text, interrupted }),
            onStatus: setStatus,
            onError: setError,
          },
          player,
        );
      } catch (err) {
        // Nothing connected — don't leak the context/player this attempt created.
        player.close();
        ctx.close();
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
        expiryTimer.current = setTimeout(() => setError("This call ends in 60 seconds."), warnAt);
      } catch (err) {
        // The socket connected but the mic failed (e.g. permission denied) —
        // don't leave a live, billing session with no way to hang it up, and
        // don't leak the AudioContext either (hangUp only closes the player).
        client.current = null;
        await relay.hangUp();
        ctx.close();
        setError(err instanceof Error ? err.message : "Could not access the microphone");
      }
    } catch (err) {
      // new AudioContext() / ctx.resume() itself failed (construction limit,
      // no audio hardware, a rejected resume()) before any connection was
      // attempted — nothing to hang up, just release whatever was created.
      player?.close();
      ctx?.close();
      setError(err instanceof Error ? err.message : "Could not start audio for the call");
    } finally {
      // Unconditionally guaranteed, whichever of the paths above ran (or none did).
      setConnecting(false);
    }
  }

  async function hangUp() {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }

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
          disabled={connecting}
          className="self-start rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-900 disabled:opacity-60"
        >
          {connecting ? "Connecting…" : "Start a call"}
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
