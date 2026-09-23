import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline, type HeardLine } from "./Timeline";
import type { Utterance } from "@/lib/ledger";

const u = (over: Partial<Utterance>): Utterance => ({
  id: "u1",
  seq: 1,
  typedText: "hello",
  spokenText: "hello",
  status: "match",
  ...over,
});
const heard = (over: Partial<HeardLine>): HeardLine => ({
  id: "h1",
  seq: 0,
  text: "Hello?",
  ...over,
});

describe("Timeline", () => {
  it("interleaves both sides in sequence order, not source order", () => {
    render(
      <Timeline
        heard={[heard({ id: "h1", seq: 0, text: "Hello?" }), heard({ id: "h2", seq: 2, text: "Sure." })]}
        utterances={[u({ id: "u1", seq: 1, typedText: "Hi, can we move Thursday?" })]}
        partial=""
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Hello?")).toBeDefined();
    expect(within(items[1]).getByText("Hi, can we move Thursday?")).toBeDefined();
    expect(within(items[2]).getByText("Sure.")).toBeDefined();
  });

  it("collapses a match to one line and a receipt, without repeating the text", () => {
    render(<Timeline heard={[]} utterances={[u({ typedText: "Yes.", spokenText: "Yes." })]} partial="" />);
    // Scoped to the row: the header also reads "1 of 1 spoken exactly".
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/spoken exactly/i)).toBeDefined();
    // The point of collapsing: the text appears once, not as typed-vs-spoken.
    expect(screen.getAllByText("Yes.")).toHaveLength(1);
  });

  it("expands a verbatim mismatch to show both texts, and flags it", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        utterances={[
          u({
            status: "mismatch",
            typedText: "make appointment",
            spokenText: "I'd like to make an appointment.",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/altered/i)).toBeDefined();
    expect(screen.getByText("make appointment")).toBeDefined();
    expect(screen.getByText("I'd like to make an appointment.")).toBeDefined();
  });

  it("marks an interrupted line", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        utterances={[u({ status: "interrupted", typedText: "Please repeat that.", spokenText: "Please" })]}
      />,
    );
    expect(screen.getByText(/interrupted/i)).toBeDefined();
  });

  it("shows the in-flight partial caption in a live region", () => {
    render(<Timeline heard={[heard({})]} utterances={[]} partial="I was thinking" />);
    const live = screen.getByText("I was thinking");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  // The regression guard for the turn indicator scrolling off the top of a long
  // call. The timeline is the ONLY scrolling region on a live screen; if it
  // stops owning its own overflow, the page scrolls instead and takes the one
  // element a deaf user depends on most off the screen with it. Asserted on the
  // class because that is where the behaviour lives — jsdom has no layout.
  it("scrolls inside itself, so the chrome around it cannot scroll away", () => {
    render(<Timeline heard={[heard({})]} utterances={[]} partial="" />);
    const region = screen.getByLabelText("Call");
    expect(region.className).toContain("overflow-y-auto");
    expect(region.className).toContain("min-h-0");
  });
});
