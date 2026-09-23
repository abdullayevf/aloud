import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TurnIndicator } from "./TurnIndicator";

describe("TurnIndicator", () => {
  it("says whose turn it is in words, not only in colour", () => {
    render(<TurnIndicator label="theirs" />);
    expect(screen.getByText(/they're speaking/i)).toBeDefined();
  });

  it("tells the user when the line is theirs to take", () => {
    render(<TurnIndicator label="listening" />);
    expect(screen.getByText(/your turn/i)).toBeDefined();
  });

  it("says when the user's own words are going out", () => {
    render(<TurnIndicator label="yours" />);
    expect(screen.getByText(/speaking your words/i)).toBeDefined();
  });

  it("announces changes to assistive technology", () => {
    render(<TurnIndicator label="theirs" />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  // Motion is a channel here, not decoration: it arrives while the other party
  // talks, it leaves while the user's line goes out, and it stops entirely when
  // the line is theirs to take. Stillness is what makes the other two readable.
  it("is completely still when the turn is the user's", () => {
    const { container } = render(<TurnIndicator label="listening" />);
    expect(container.querySelectorAll(".ring, .sweep, .breathe")).toHaveLength(0);
  });

  it("moves while either side is talking", () => {
    expect(render(<TurnIndicator label="theirs" />).container.querySelectorAll(".ring").length).toBe(2);
    expect(render(<TurnIndicator label="yours" />).container.querySelectorAll(".sweep").length).toBe(1);
  });
});
