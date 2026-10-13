import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Provider } from "../../types";
import { ProviderEditor } from "./ProviderEditor";

const savedProvider: Provider = {
  id: "provider-test",
  name: "创作模型",
  kind: "text",
  protocol: "openai",
  baseUrl: "https://models.example.test/v1",
  model: "story-model",
  hasKey: true,
  enabled: true,
};

function openEditor(provider: Provider | null = savedProvider) {
  const mutate = vi.fn().mockResolvedValue({});
  const onClose = vi.fn();
  render(
    <ProviderEditor
      provider={provider}
      initialKind="text"
      initialPreset={null}
      mutate={mutate}
      notify={vi.fn()}
      onClose={onClose}
      onSaved={vi.fn()}
    />,
  );
  return { mutate, onClose };
}

describe("model credentials form", () => {
  it("explains invalid required fields and URL protocols instead of disabling save", () => {
    const { mutate } = openEditor(null);
    const save = screen.getByRole("button", { name: "保存服务" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(screen.getByText("请填写服务名称")).toBeTruthy();
    expect(screen.getByText("请填写接口地址")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("服务名称"), {
      target: { value: "创作模型" },
    });
    fireEvent.change(screen.getByLabelText("接口地址"), {
      target: { value: "ftp://models.example.test" },
    });
    fireEvent.click(save);
    expect(screen.getByText(/请输入以 https:\/\/ 或 http:\/\/ 开头/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps API errors visible inside the editor and retains the draft for retry", async () => {
    const { mutate, onClose } = openEditor();
    mutate.mockRejectedValueOnce(new Error("更换接口地址后请重新填写密钥。"));
    fireEvent.change(screen.getByLabelText("接口地址"), {
      target: { value: "https://new.example.test/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存服务" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "更换接口地址后请重新填写密钥。",
    );
    expect((screen.getByLabelText("接口地址") as HTMLInputElement).value).toBe(
      "https://new.example.test/v1",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it("keeps a saved key when an existing service is saved with a blank key field", async () => {
    const { mutate, onClose } = openEditor();

    fireEvent.change(screen.getByLabelText("服务名称"), {
      target: { value: "重命名的创作模型" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存服务" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mutate).toHaveBeenCalledWith(
      "/providers/provider-test",
      expect.objectContaining({
        name: "重命名的创作模型",
        apiKey: "",
        clearApiKey: false,
      }),
      "PATCH",
    );
  });

  it("clears both the draft key and the saved key only after explicit selection", async () => {
    const { mutate } = openEditor();
    fireEvent.change(screen.getByLabelText(/API 密钥/), {
      target: { value: "temporary-test-key" },
    });
    fireEvent.click(screen.getByLabelText("清除已保存的密钥"));
    fireEvent.click(screen.getByRole("button", { name: "保存服务" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    expect(mutate).toHaveBeenCalledWith(
      "/providers/provider-test",
      expect.objectContaining({ apiKey: "", clearApiKey: true }),
      "PATCH",
    );
  });

  it("does not carry a draft key or enabled state into a different provider preset", async () => {
    const { mutate } = openEditor(null);
    fireEvent.change(screen.getByLabelText(/API 密钥/), {
      target: { value: "temporary-test-key" },
    });
    fireEvent.click(screen.getByLabelText("从常用预设开始"));
    fireEvent.click(screen.getByRole("option", { name: "Claude" }));

    expect((screen.getByLabelText(/API 密钥/) as HTMLInputElement).value).toBe("");
    expect(
      screen.getByRole("switch", { name: "启用模型服务" }).getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "保存服务" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    expect(mutate).toHaveBeenCalledWith(
      "/providers",
      expect.objectContaining({
        name: "Claude",
        protocol: "anthropic",
        apiKey: "",
        clearApiKey: false,
        enabled: false,
      }),
      "POST",
    );
  });
});
