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
});
