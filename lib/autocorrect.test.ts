import { describe, expect, it } from "vitest";
import { correctAtBoundary, correctFinalWord, correctToken } from "./autocorrect";

describe("correctToken", () => {
  it("fixes the transpositions a fast typist actually makes", () => {
    expect(correctToken("teh")).toBe("the");
    expect(correctToken("adn")).toBe("and");
    expect(correctToken("woudl")).toBe("would");
  });

  it("restores the apostrophe where the bare form is not a word", () => {
    expect(correctToken("dont")).toBe("don't");
    expect(correctToken("cant")).toBe("can't");
    expect(correctToken("im")).toBe("I'm");
  });

  it("capitalises the lone pronoun", () => {
    expect(correctToken("i")).toBe("I");
  });

  it("carries the typed capitalisation across", () => {
    expect(correctToken("Teh")).toBe("The");
    expect(correctToken("TEH")).toBe("THE");
  });

  it("leaves mixed-case words alone — those are names and acronyms", () => {
    expect(correctToken("TeH")).toBeNull();
    expect(correctToken("iPhone")).toBeNull();
  });

  it("never touches a word it does not know", () => {
    expect(correctToken("hello")).toBeNull();
    expect(correctToken("Thursday")).toBeNull();
    expect(correctToken("Abdullayev")).toBeNull();
  });

  // The precision requirement, stated as a test. Each of these has two ordinary
  // English readings, so there is no confident answer and we must not invent one.
  it("refuses the ambiguous ones rather than guessing", () => {
    for (const word of ["its", "lets", "were", "well", "ill", "id", "wed", "form", "hwo"]) {
      expect(correctToken(word), word).toBeNull();
    }
  });

  it("stays out of anything carrying a digit", () => {
    expect(correctToken("teh2")).toBeNull();
    expect(correctToken("415")).toBeNull();
  });
});

describe("correctAtBoundary", () => {
  const caretAtEnd = (text: string) => correctAtBoundary(text, text.length);

  it("fires when a word is finished, not while it is being typed", () => {
    expect(correctAtBoundary("teh", 3)).toBeNull();
    expect(caretAtEnd("teh ")?.text).toBe("the ");
  });

  it("treats punctuation as the end of a word too", () => {
    expect(caretAtEnd("i said taht.")?.text).toBe("i said that.");
    expect(caretAtEnd("teh,")?.text).toBe("the,");
  });

  it("corrects only the word that was just finished", () => {
    expect(caretAtEnd("teh cat sat adn ")?.text).toBe("teh cat sat and ");
  });

  it("moves the caret by the length the replacement changed", () => {
    const result = caretAtEnd("alot ");
    expect(result?.text).toBe("a lot ");
    expect(result?.caret).toBe(6);
  });

  it("reports what it changed so the screen can say so", () => {
    expect(caretAtEnd("dont ")?.correction).toEqual({ from: "dont", to: "don't" });
  });

  it("works mid-line, not only at the end", () => {
    const result = correctAtBoundary("teh end", 4);
    expect(result?.text).toBe("the end");
    expect(result?.caret).toBe(4);
  });

  it("stays silent on a word it does not know", () => {
    expect(caretAtEnd("hello ")).toBeNull();
  });

  it("survives a caret that is out of range rather than throwing", () => {
    expect(correctAtBoundary("teh ", 99)).toBeNull();
    expect(correctAtBoundary("", 0)).toBeNull();
  });
});

describe("correctFinalWord", () => {
  it("catches the last word when Enter comes with no trailing space", () => {
    expect(correctFinalWord("that is teh")).toEqual({
      text: "that is the",
      correction: { from: "teh", to: "the" },
    });
  });

  it("leaves a finished line untouched", () => {
    expect(correctFinalWord("that is the ")).toEqual({ text: "that is the ", correction: null });
    expect(correctFinalWord("")).toEqual({ text: "", correction: null });
  });

  it("does not reach past punctuation into an already-corrected word", () => {
    expect(correctFinalWord("teh.").correction).toBeNull();
  });
});
