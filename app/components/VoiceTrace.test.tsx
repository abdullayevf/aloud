import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceTrace } from "./VoiceTrace";
import { LevelTrace } from "@/lib/audio/level-trace";

describe("VoiceTrace", () => {
  it("is hidden from assistive technology — the turn label carries the text", () => {
    const { container } = render(<VoiceTrace trace={new LevelTrace(8)} live />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders without throwing when the 2d context is unavailable", () => {
    // jsdom returns null here, and so does a real browser with canvas blocked
    // or under memory pressure. A missing context must cost the trace, never
    // the call.
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    expect(() => render(<VoiceTrace trace={new LevelTrace(8)} live />)).not.toThrow();
    spy.mockRestore();
  });

  it("stops requesting frames once the call is no longer live", () => {
    // jsdom's real getContext() returns null, which makes the component bail
    // out before it ever schedules a frame — so cancelAnimationFrame would
    // never be registered and this test would pass for the wrong reason (or
    // not exercise the cleanup path at all). Stub just enough of a 2d context
    // for the draw loop to run: setTransform, clearRect, fillRect, and a
    // writable fillStyle. This is the one test where getContext must NOT
    // return null — the test above already covers that degradation path.
    const fakeCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);

    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { rerender } = render(<VoiceTrace trace={new LevelTrace(8)} live />);
    rerender(<VoiceTrace trace={new LevelTrace(8)} live={false} />);
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
    getContext.mockRestore();
  });
});
