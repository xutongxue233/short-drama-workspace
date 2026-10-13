import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps failures visible until dismissed", () => {
  const dismiss = vi.fn();
  render(
    <Toast
      toast={{ kind: "error", message: "保存失败，请重试" }}
      onDismiss={dismiss}
    />,
  );
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.getByRole("alert").textContent).toContain("保存失败");
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  expect(dismiss).toHaveBeenCalledOnce();
});

it("pauses a success notice while hovered or keyboard focused", () => {
  const dismiss = vi.fn();
  render(
    <Toast toast={{ kind: "success", message: "项目已保存" }} onDismiss={dismiss} />,
  );
  act(() => vi.advanceTimersByTime(2000));
  fireEvent.mouseEnter(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(10000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole("button", { name: "关闭提示" }));
  fireEvent.mouseLeave(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(10000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByRole("button", { name: "关闭提示" }));
  act(() => vi.advanceTimersByTime(2499));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledOnce();
});

it("gives a replacement notice its own lifetime and cleans up on unmount", () => {
  const dismiss = vi.fn();
  const view = render(
    <Toast toast={{ kind: "success", message: "第一次保存" }} onDismiss={dismiss} />,
  );
  act(() => vi.advanceTimersByTime(4000));
  view.rerender(
    <Toast toast={{ kind: "success", message: "第二次保存" }} onDismiss={dismiss} />,
  );
  act(() => vi.advanceTimersByTime(4000));
  expect(dismiss).not.toHaveBeenCalled();
  view.unmount();
  act(() => vi.advanceTimersByTime(10000));
  expect(dismiss).not.toHaveBeenCalled();
});
