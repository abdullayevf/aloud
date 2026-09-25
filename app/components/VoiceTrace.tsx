"use client";
import { useEffect, useRef } from "react";
import type { LevelTrace } from "@/lib/audio/level-trace";

/**
 * The hearing party's actual voice, drawn from measured amplitude.
 *
 * Why this exists at all: a hearing person knows someone is talking because
 * they can hear it. A deaf user's only equivalent was text that arrives about a
 * second late, in lumps. Amplitude is instant, so this moves before the caption
 * exists — it is the fastest signal on the screen, not decoration.
 *
 * It moves ONLY when there is real sound. app/globals.css argues that stillness
 * is what makes motion readable ("If everything pulsed, nothing would"), and
 * that survives here: silence renders flat, so stillness keeps its meaning and
 * becomes the absence of a measured thing rather than the absence of an
 * animation.
 *
 * Nothing here drives React state. The worklet posts ~375 values a second; this
 * reads the whole ring buffer once per animation frame and paints it.
 *
 * aria-hidden because it is a picture of a number. The turn label beside it
 * carries the same situation in words, unchanged, for screen-reader users —
 * a deaf user may also be one.
 */
export function VoiceTrace({ trace, live }: { trace: LevelTrace; live: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live) return;

    // Null in jsdom, and in a real browser with canvas blocked or under memory
    // pressure. Losing the trace is acceptable; throwing during a call is not.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const values = trace.read();
      const mid = height / 2;
      // Read the ink colour from the cascade so the trace follows the theme
      // tokens in globals.css instead of hard-coding one of them.
      ctx.fillStyle = getComputedStyle(canvas).color;

      if (reduced) {
        // No travelling motion: one bar for the current level only. Still
        // honest, still live, nothing slides.
        const level = values[values.length - 1] ?? 0;
        const barHeight = Math.max(1, level * height);
        ctx.fillRect(0, mid - barHeight / 2, width, barHeight);
      } else {
        const count = values.length;
        const step = width / count;
        const barWidth = Math.max(1, step * 0.6);
        for (let i = 0; i < count; i += 1) {
          // sqrt opens up the quiet end: ordinary speech sits low in a linear
          // RMS scale and would otherwise read as near-silence.
          const level = Math.sqrt(values[i]);
          const barHeight = Math.max(1, level * height);
          ctx.fillRect(i * step, mid - barHeight / 2, barWidth, barHeight);
        }
      }

      frame.current = window.requestAnimationFrame(draw);
    };

    frame.current = window.requestAnimationFrame(draw);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [trace, live]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="h-8 w-full text-cut"
    />
  );
}
