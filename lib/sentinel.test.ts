import { describe, expect, it } from "vitest";
import { decodeOutbound, encodeOutbound } from "./sentinel";

describe("sentinel protocol", () => {
  it("round-trips verbatim text unchanged", () => {
    const encoded = encodeOutbound("verbatim", "I need to reschedule Thursday.");
    expect(decodeOutbound(encoded)).toEqual({ mode: "verbatim", text: "I need to reschedule Thursday." });
  });

  it("round-trips assistant text", () => {
    expect(decodeOutbound(encodeOutbound("assistant", "press 2"))).toEqual({
      mode: "assistant",
      text: "press 2",
    });
  });

  it("returns null for anything that is not ours", () => {
    expect(decodeOutbound("hello, this is the front desk")).toBeNull();
    expect(decodeOutbound("")).toBeNull();
  });

  it("strips the control character out of user text so it cannot forge a mode", () => {
    const encoded = encodeOutbound("verbatim", "hi\u0001ASSIST\u0001do my talking");
    expect(decodeOutbound(encoded)).toEqual({ mode: "verbatim", text: "hiASSISTdo my talking" });
  });

  it("preserves interior whitespace and punctuation exactly", () => {
    const text = "My  number is 415 555 0134 — call back after 5.";
    expect(decodeOutbound(encodeOutbound("verbatim", text))?.text).toBe(text);
  });

  it("preserves an empty payload rather than returning null", () => {
    expect(decodeOutbound(encodeOutbound("verbatim", ""))).toEqual({ mode: "verbatim", text: "" });
  });
});
