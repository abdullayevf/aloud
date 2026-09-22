import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ledger } from "./Ledger";
import type { Utterance } from "@/lib/ledger";

const u = (over: Partial<Utterance>): Utterance => ({
  id: "1",
  typedText: "hello",
  spokenText: "hello",
  mode: "verbatim",
  status: "match",
  ...over,
});

describe("Ledger", () => {
  it("shows the running verbatim count", () => {
    render(<Ledger utterances={[u({}), u({ id: "2" })]} />);
    expect(screen.getByText(/2 of 2 relayed verbatim/i)).toBeDefined();
  });

  it("shows a mismatch as a mismatch and prints both texts", () => {
    render(
      <Ledger utterances={[u({ status: "mismatch", typedText: "make appointment", spokenText: "I'd like to make an appointment." })]} />,
    );
    expect(screen.getByText(/altered/i)).toBeDefined();
    expect(screen.getByText("make appointment")).toBeDefined();
    expect(screen.getByText("I'd like to make an appointment.")).toBeDefined();
  });

  it("marks assistant-mode lines and excludes them from the count", () => {
    render(<Ledger utterances={[u({}), u({ id: "2", mode: "assistant" })]} />);
    expect(screen.getByText(/1 of 1 relayed verbatim/i)).toBeDefined();
    expect(screen.getByText(/assistant/i)).toBeDefined();
  });

  it("calls an assistant-mode mismatch a paraphrase, not an alteration, and does not flag it", () => {
    render(
      <Ledger
        utterances={[
          u({
            mode: "assistant",
            status: "mismatch",
            typedText: "press 2",
            spokenText: "Pressing two now.",
          }),
        ]}
      />,
    );
    const label = screen.getByText(/assistant spoke/i);
    expect(label).toBeDefined();
    expect(screen.queryByText(/altered/i)).toBeNull();
    // Amber is the "we altered your words" treatment — it must not appear on a
    // paraphrase the user explicitly delegated.
    expect(label.className).not.toContain("text-amber-400");
  });
});
