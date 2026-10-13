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
