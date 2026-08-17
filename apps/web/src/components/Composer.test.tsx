import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerSettings } from "./Composer";

const settings: ComposerSettings = {
  model: "",
  serviceTier: "",
  effort: "",
  collaborationMode: "",
  permissions: "",
};

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test-image"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

function renderComposer(active = false) {
  const onSend = vi.fn(async () => undefined);
  const onInterrupt = vi.fn(async () => undefined);
  render(
    <Composer
      active={active}
      disabled={false}
      submitting={false}
      models={[{ value: "gpt-test", label: "GPT Test" }]}
      collaborationModes={[{ value: "plan", label: "计划" }]}
      permissionProfiles={[{ value: "workspace", label: "Workspace" }]}
      settings={settings}
      draft={null}
      onSettings={() => undefined}
      onSend={onSend}
      onInterrupt={onInterrupt}
    />,
  );
  return { onSend, onInterrupt };
}

describe("Composer", () => {
  it("sends trimmed text with Enter and clears the input", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer();
    const input = screen.getByLabelText("发送消息");

    await user.type(input, "  检查当前实现  {Enter}");

    expect(onSend).toHaveBeenCalledWith("检查当前实现", []);
    expect(input).toHaveValue("");
  });

  it("offers steer and interrupt controls while a turn is active", async () => {
    const user = userEvent.setup();
    const { onSend, onInterrupt } = renderComposer(true);

    await user.type(screen.getByLabelText("发送消息"), "追加约束");
    await user.click(screen.getByRole("button", { name: "追加指令" }));
    await user.click(screen.getByRole("button", { name: "中断" }));

    expect(onSend).toHaveBeenCalledWith("追加约束", []);
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("previews and sends a supported image", async () => {
    const user = userEvent.setup();
    const { onSend } = renderComposer();
    const image = new File([new Uint8Array([1, 2, 3])], "screen.png", {
      type: "image/png",
    });

    await user.upload(screen.getByLabelText("选择图片"), image);
    expect(screen.getByRole("img", { name: "screen.png" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("", [image]);
  });
});
