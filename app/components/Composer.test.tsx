import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

// fireEvent rather than user-event: the plan forbids new dependencies, and
// user-event is not in package.json.
const props = {
  value: "",
  onChange: () => {},
  onSend: () => {},
  disabled: false,
  continuation: null,
  onContinuationUsed: () => {},
};
const box = () => screen.getByRole("textbox", { name: /type what you want said/i });
const type = (value: string) => fireEvent.change(box(), { target: { value } });

/** The composer is controlled by the page, so anything that depends on the
 * corrected value coming back down needs a real state holder. */
function Live({ onSend = () => {} }: { onSend?: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={onSend}
      disabled={false}
      continuation={null}
      onContinuationUsed={() => {}}
    />
  );
}

describe("Composer", () => {
  it("shows the value it is given rather than its own state", () => {
    render(<Composer {...props} value="repeat that." />);
    expect((box() as HTMLTextAreaElement).value).toBe("repeat that.");
  });

  it("reports every keystroke upward", () => {
    const onChange = vi.fn();
    render(<Composer {...props} onChange={onChange} />);
    type("a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("does not send an empty line", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value="  " onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends the trimmed line", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value=" Yes. " onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Yes.");
  });

  it("does not send on shift+Enter — that is a new line", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value="Yes." onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the box through the page after sending, never on its own", () => {
    const onChange = vi.fn();
    render(<Composer {...props} value="Yes." onChange={onChange} onSend={() => {}} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("sends a quick phrase with one press", () => {
    const onSend = vi.fn();
    render(<Composer {...props} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Please repeat that." }));
    expect(onSend).toHaveBeenCalledWith("Please repeat that.");
  });

  it("has no mode to choose — there is one mode and this is it", () => {
    render(<Composer {...props} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/assistant/i)).toBeNull();
  });
});

describe("Composer typo correction", () => {
  it("fixes a word once it is finished", () => {
    render(<Live />);
    type("teh ");
    expect((box() as HTMLTextAreaElement).value).toBe("the ");
  });

  it("leaves a word alone while it is still being typed", () => {
    render(<Live />);
    type("teh");
    expect((box() as HTMLTextAreaElement).value).toBe("teh");
  });

  it("says on screen what it changed, so nothing is altered invisibly", () => {
    render(<Live />);
    type("dont ");
    expect(screen.getByText(/changed/i).textContent).toMatch(/dont.*don't/);
  });

  it("puts the typo back when the correction is undone", () => {
    render(<Live />);
    type("teh ");
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect((box() as HTMLTextAreaElement).value).toBe("teh ");
    expect(screen.queryByText(/changed/i)).toBeNull();
  });

  it("puts the typo back on backspace, the way a phone keyboard does", () => {
    render(<Live />);
    type("teh ");
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect((box() as HTMLTextAreaElement).value).toBe("teh ");
  });

  it("lets backspace delete normally once the user has typed on", () => {
    render(<Live />);
    type("teh ");
    type("the cat");
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect((box() as HTMLTextAreaElement).value).toBe("the cat");
  });

  it("catches the last word on Enter, which never met a space", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value="that is teh" onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("that is the");
  });

  // Once it has been spoken there is nothing to undo, and offering a button
  // that cannot work would be worse than saying nothing.
  it("reports a correction made on send without offering to undo it", () => {
    render(<Live />);
    type("teh");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(screen.getByText(/changed/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});

describe("Composer — continuing a line that was cut off", () => {
  function setup(props: Partial<ComponentProps<typeof Composer>> = {}) {
    const onChange = vi.fn();
    const onContinuationUsed = vi.fn();
    const utils = render(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation={null}
        onContinuationUsed={onContinuationUsed}
        {...props}
      />,
    );
    return { ...utils, onChange, onContinuationUsed };
  }

  it("puts the unspoken tail in the box when the box is empty", () => {
    const { rerender, onChange } = setup();
    rerender(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation="for next Tuesday"
        onContinuationUsed={vi.fn()}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("for next Tuesday");
  });

  it("says so, rather than text appearing in the box unexplained", () => {
    setup({ value: "for next Tuesday", continuation: "for next Tuesday" });
    // toBeDefined, not toBeInTheDocument: this repo's vitest setup does not
    // register @testing-library/jest-dom's matchers (no other test in this
    // file uses them either — see the "reports a correction..." test below),
    // and getByText already throws if nothing matches.
    expect(screen.getByText(/cut off/i)).toBeDefined();
  });

  it("never clobbers something the user is already typing", () => {
    const { onChange } = setup({ value: "actually, never mind", continuation: "for next Tuesday" });
    expect(onChange).not.toHaveBeenCalledWith("for next Tuesday");
  });

  it("does not re-fill a second time once the user has cleared the box", () => {
    // A second interruption while the first remainder sits unsent must not
    // overwrite it, and an already-consumed remainder must not come back.
    const { rerender, onChange } = setup({ value: "", continuation: "first tail" });
    onChange.mockClear();
    rerender(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation="first tail"
        onContinuationUsed={vi.fn()}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  // Regression: the page consumes a continuation in the same tick it offers
  // it — onChange(remainder) and onContinuationUsed() both fire inside the
  // fill effect, and React 19 batches them into one parent re-render. So the
  // very first render where `value` actually equals the remainder is ALSO
  // the render where the page has already nulled `continuation` back out.
  // A notice keyed off the `continuation` prop is false at every render a
  // real user ever sees. This drives that exact ordering — value arriving
  // filled and continuation arriving null in the SAME rerender — rather than
  // the earlier tests' hand-fed matching props, which never exercised it.
  it("still shows the notice once the page has consumed the continuation, same tick", () => {
    const { rerender, onChange } = setup({ continuation: "for next Tuesday" });
    rerender(
      <Composer
        value="for next Tuesday"
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation={null}
        onContinuationUsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/cut off/i)).toBeDefined();
  });
});
