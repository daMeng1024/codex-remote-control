import type { PendingRequestDto } from "@codex-remote/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalDrawer } from "./ApprovalDrawer";

const request: PendingRequestDto = {
  id: "request-1",
  kind: "command",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  title: "命令执行审批",
  reason: "需要联网",
  command: "npm install",
  cwd: "/home/epean/code/project",
  createdAt: 1,
  decisions: [
    { id: "allow", label: "允许一次", tone: "primary" },
    { id: "deny", label: "拒绝", tone: "danger" },
  ],
  questions: [],
  resolved: false,
};

describe("ApprovalDrawer", () => {
  it("renders only supplied decisions and submits the selected one", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn(async () => undefined);
    render(<ApprovalDrawer requests={[request]} onRespond={onRespond} />);

    expect(
      screen.queryByRole("button", { name: "本会话允许" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "拒绝" }));

    expect(onRespond).toHaveBeenCalledWith("request-1", {
      decisionId: "deny",
      answers: {},
    });
  });
});
