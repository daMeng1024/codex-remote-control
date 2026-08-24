import type { TimelineItemDto, TurnDto } from "@codex-remote/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

const commandItem: TimelineItemDto = {
  id: "command-1",
  turnId: "turn-1",
  type: "command",
  status: "completed",
  title: "命令执行",
  text: null,
  command: "rg -n TODO",
  cwd: "/home/epean/code/project",
  output: "first line\nsecond line",
  exitCode: 0,
  durationMs: 120,
  fileChanges: [],
  images: [],
};

const turns: TurnDto[] = [
  {
    id: "turn-1",
    status: "completed",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1_000,
    items: [commandItem],
  },
];

describe("Timeline", () => {
  it("collapses command output until it is requested", () => {
    render(
      <Timeline turns={turns} loading={false} onEditUserMessage={vi.fn()} />,
    );

    const disclosure = document.querySelector(
      "details.output-disclosure",
    ) as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(screen.getByText("2 行")).toBeVisible();

    fireEvent.click(screen.getByText("查看输出"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByText(/first line/)).toBeVisible();
  });
});
