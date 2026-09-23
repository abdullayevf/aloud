import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

// fireEvent rather than user-event: the plan forbids new dependencies, and
// user-event is not in package.json.
const props = {
  value: "",
  onChange: () => {},
  onSend: () => {},
  mode: "verbatim" as const,
  onModeChange: () => {},
  disabled: false,
};
const box = () => screen.getByRole("textbox", { name: /type what you want said/i });

describe("Composer", () => {
  it("shows the value it is given rather than its own state", () => {
    render(<Composer {...props} value="repeat that." />);
    expect((box() as HTMLTextAreaElement).value).toBe("repeat that.");
  });

  it("reports every keystroke upward", () => {
    const onChange = vi.fn();
    render(<Composer {...props} onChange={onChange} />);
    fireEvent.change(box(), { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("does not send an empty line", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value="  " onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends the trimmed line with the current mode", () => {
    const onSend = vi.fn();
    render(<Composer {...props} value=" Yes. " onSend={onSend} />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Yes.", "verbatim");
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
    expect(onSend).toHaveBeenCalledWith("Please repeat that.", "verbatim");
  });
});
