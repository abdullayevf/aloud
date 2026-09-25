import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline, type HeardLine } from "./Timeline";
import { remainderOf, type Utterance } from "@/lib/ledger";

const u = (over: Partial<Utterance>): Utterance => ({
  id: "u1",
  seq: 1,
  typedText: "hello",
  spokenText: "hello",
  status: "match",
  remainder: null,
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
        ink={null}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Hello?")).toBeDefined();
    expect(within(items[1]).getByText("Hi, can we move Thursday?")).toBeDefined();
    expect(within(items[2]).getByText("Sure.")).toBeDefined();
  });

  // NOTE: this test originally asserted `getByText(/spoken exactly/i)` inside
  // the row — the pre-Task-6 design, where a match printed the receipt word as
  // visible text under the card. Task 6 deliberately removes that: "keeps a
  // matched line quiet" below is the fuller spec, and it asserts the opposite
  // — that the same text is NOT queryable, because it now lives on the icon's
  // aria-label rather than as a text node. The two assertions cannot both
  // hold, so this test is updated to check what the redesign actually
  // promises (one line, no repeated text, the receipt still reachable by
  // assistive tech) rather than deleted or left contradicting the new design.
  it("collapses a match to one line and a mark, without repeating the text", () => {
    render(<Timeline heard={[]} utterances={[u({ typedText: "Yes.", spokenText: "Yes." })]} partial="" ink={null} />);
    const row = screen.getByRole("listitem");
    const icon = within(row).getByRole("img", { hidden: true });
    expect(icon.getAttribute("aria-label")).toMatch(/spoken exactly/i);
    // The point of collapsing: the text appears once, not as typed-vs-spoken.
    expect(screen.getAllByText("Yes.")).toHaveLength(1);
  });

  it("expands a verbatim mismatch to show both texts, and flags it", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        ink={null}
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
        ink={null}
        utterances={[u({ status: "interrupted", typedText: "Please repeat that.", spokenText: "Please" })]}
      />,
    );
    expect(screen.getByText(/interrupted/i)).toBeDefined();
  });

  it("shows the in-flight partial caption in a live region", () => {
    render(<Timeline heard={[heard({})]} utterances={[]} partial="I was thinking" ink={null} />);
    const live = screen.getByText("I was thinking");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  // The regression guard for the turn indicator scrolling off the top of a long
  // call. The timeline is the ONLY scrolling region on a live screen; if it
  // stops owning its own overflow, the page scrolls instead and takes the one
  // element a deaf user depends on most off the screen with it. Asserted on the
  // class because that is where the behaviour lives — jsdom has no layout.
  it("scrolls inside itself, so the chrome around it cannot scroll away", () => {
    render(<Timeline heard={[heard({})]} utterances={[]} partial="" ink={null} />);
    const region = screen.getByLabelText("Call");
    expect(region.className).toContain("overflow-y-auto");
    expect(region.className).toContain("min-h-0");
  });
});

// Task 6's own tests, from the brief. Two edits: `toBeInTheDocument()` in the
// brief's source is a jest-dom matcher, and this repo never registers
// jest-dom's matchers (see Composer.test.tsx) — every other assertion here
// uses `.toBeDefined()` on a `getBy*` result, which already throws if nothing
// is found, so that is what these use too. The assertions themselves are
// unchanged from the brief.
describe("Timeline — what was actually said", () => {
  it("shows the unspoken tail of a cut-off line instead of only saying 'interrupted'", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[
          u({
            status: "interrupted",
            typedText: "I'd like to book an appointment for next Tuesday",
            spokenText: "I'd like to book an appointment",
            remainder: "for next Tuesday",
          }),
        ]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/for next Tuesday/)).toBeDefined();
  });

  it("keeps a matched line quiet — no card, no chip, just the mark", () => {
    const { container } = render(
      <Timeline heard={[]} utterances={[u({ status: "match" })]} partial="" ink={null} />,
    );
    expect(screen.queryByText(/spoken exactly/i)).toBeNull();
    expect(container.querySelector("[data-receipt='match']")).not.toBeNull();
  });

  it("keeps a mismatch loud — it is the one state that must be read", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[u({ status: "mismatch", typedText: "Yes.", spokenText: "No." })]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/altered/i)).toBeDefined();
    expect(screen.getByText("No.")).toBeDefined();
  });

  it("inks the words already spoken and leaves the rest ghosted", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[u({ id: "u1", status: "pending", typedText: "I would like to reschedule" })]}
        partial=""
        ink={{ id: "u1", spoken: "I would ", unspoken: "like to reschedule" }}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("I would", { exact: false })).toBeDefined();
    expect(row.querySelector("[data-ink='unspoken']")?.textContent).toContain("like to reschedule");
  });
});

// I1. `remainderOf` returns the WHOLE typed line when the spoken text is not a
// clean prefix — the right fallback for the composer, a false statement as a
// caption. These lock the two halves of that distinction.
describe("Timeline — an interruption must not misreport what was spoken", () => {
  it("does not print 'not spoken' over words the provider's record says were spoken", () => {
    // Measured shape of the failure: TTS says "a appointment" where the user
    // typed "an appointment". The prefix match breaks at word three, so
    // remainderOf falls back to the whole line — including six words that
    // demonstrably DID go out.
    const typedText = "I'd like an appointment for next Tuesday";
    const spokenText = "I'd like a appointment for next";
    const remainder = remainderOf(typedText, spokenText);
    expect(remainder).toBe(typedText); // the fallback, not a tail

    render(
      <Timeline
        heard={[]}
        utterances={[u({ status: "interrupted", typedText, spokenText, remainder })]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.queryByText(/not spoken/i)).toBeNull();
    expect(screen.getByText(/does not line up/i)).toBeDefined();
    // The typed line is still shown — the user is told what they wrote, just
    // not told a falsehood about which of it got out.
    expect(screen.getByText(typedText)).toBeDefined();
  });

  it("keeps 'not spoken' for a genuine tail", () => {
    const typedText = "I'd like an appointment for next Tuesday";
    const spokenText = "I'd like an appointment";
    const remainder = remainderOf(typedText, spokenText);
    expect(remainder).toBe("for next Tuesday");

    render(
      <Timeline
        heard={[]}
        utterances={[u({ status: "interrupted", typedText, spokenText, remainder })]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/not spoken/i)).toBeDefined();
    expect(screen.queryByText(/does not line up/i)).toBeNull();
  });

  it("keeps 'not spoken' when nothing at all was spoken", () => {
    // remainderOf also returns the whole line when the record holds no words,
    // and there the label is simply true: none of it got out.
    const typedText = "Please hold on.";
    const remainder = remainderOf(typedText, "");
    expect(remainder).toBe(typedText);

    render(
      <Timeline
        heard={[]}
        utterances={[u({ status: "interrupted", typedText, spokenText: "", remainder })]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/not spoken/i)).toBeDefined();
    expect(screen.queryByText(/does not line up/i)).toBeNull();
  });
});
