import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api";
import { ModelPicker, type ModelDiscoveryConfig } from "./ModelPicker";

vi.mock("../../api", () => ({ request: vi.fn() }));
const config: ModelDiscoveryConfig = {
  providerId: "saved",
  kind: "image",
  protocol: "openai",
  baseUrl: "https://example.test/v1",
};
const catalog = {
  models: [{ id: "image-new", name: "image-new" }],
  source: "remote",
  message: "确认模型支持图像生成后再使用。",
  truncated: false,
};
describe("model discovery picker", () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });
  it("fetches without saving, retains the selected model and lets the user choose a remote result", async () => {
    vi.mocked(request).mockResolvedValue(catalog);
    const change = vi.fn();
    render(
      <ModelPicker
        id="model"
        value="existing-model"
        onChange={change}
        config={config}
        presets={["image-preset"]}
      />,
    );
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));
    await screen.findByText("已从接口获取 1 个模型");
    expect(request).toHaveBeenCalledWith(
      "/providers/models",
      config,
      "POST",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "模型名称" }));
    fireEvent.click(screen.getByRole("option", { name: "image-new" }));
    expect(change).toHaveBeenCalledWith("image-new");
  });
  it("preserves custom entry after a discovery error", async () => {
    vi.mocked(request).mockRejectedValue(new Error("接口未提供模型列表"));
    const change = vi.fn();
    render(
      <ModelPicker id="model" value="current" onChange={change} config={config} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));
    await screen.findByRole("alert");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "手动输入" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模型名称" }), {
      target: { value: "private-deployment" },
    });
    expect(change).toHaveBeenCalledWith("private-deployment");
  });
  it("aborts stale discovery and hides a previous service's catalog on switch", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const change = vi.fn();
    const view = render(
      <ModelPicker id="model" value="" onChange={change} config={config} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));
    const signal = vi.mocked(request).mock.calls[0][3]?.signal;
    view.rerender(
      <ModelPicker
        id="model"
        value=""
        onChange={change}
        config={{ ...config, providerId: "another" }}
      />,
    );
    expect(signal?.aborted).toBe(true);
    resolve(catalog);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "获取模型" })).toBeTruthy(),
    );
    expect(screen.queryByText("已从接口获取 1 个模型")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it("identifies preset fallback without claiming the account can use it", async () => {
    vi.mocked(request).mockResolvedValue({
      ...catalog,
      source: "preset",
      message: "预设未验证账号权限。",
    });
    render(<ModelPicker id="model" value="" onChange={vi.fn()} config={config} />);
    fireEvent.click(screen.getByRole("button", { name: "获取模型" }));
    await screen.findByText("当前显示官方预设");
    expect(screen.queryByText(/已从接口获取/)).toBeNull();
    expect(screen.getByText("预设未验证账号权限。")).toBeTruthy();
  });
});
