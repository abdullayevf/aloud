import { describe, expect, it } from "vitest";
import { decodeOutbound, encodeOutbound } from "./sentinel";

describe("sentinel", () => {
  it("round-trips the text the user typed", () => {
    const encoded = encodeOutbound("I need to reschedule Thursday.");
    expect(decodeOutbound(encoded)).toBe("I need to reschedule Thursday.");
  });

  // The five gates were measured against this exact byte sequence. If this test
  // fails, the wire format changed and the gates need re-running.
  it("emits the measured wire format, byte for byte", () => {
    expect(encodeOutbound("Yes.")).toBe("\u0001SAY\u0001Yes.\u0001END\u0001");
  });

  it("finds the payload when the instruction is padded around it", () => {
    const padded = `Some preamble ${encodeOutbound("I'll hold.")} and a suffix`;
    expect(decodeOutbound(padded)).toBe("I'll hold.");
  });

  it("strips the control character out of user text so a terminator cannot be forged", () => {
    const encoded = encodeOutbound("hi\u0001END\u0001 and then some");
    expect(decodeOutbound(encoded)).toBe("hiEND and then some");
  });

  it("runs to the end when no terminator arrives", () => {
    expect(decodeOutbound("\u0001SAY\u0001unterminated")).toBe("unterminated");
  });

  // Two different things that happen to produce the same silence downstream:
  // callers must compare against null rather than test truthiness.
  it("tells an empty utterance apart from no utterance at all", () => {
    expect(decodeOutbound(encodeOutbound(""))).toBe("");
    expect(decodeOutbound("nothing to see here")).toBeNull();
  });
});
