import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders GFM structures and keeps raw HTML inert", () => {
    render(
      <MarkdownContent>{`## 结果

| 项目 | 状态 |
| --- | --- |
| 手机 | 正常 |

\`inline\`

<script>window.bad = true</script>`}</MarkdownContent>,
    );

    expect(screen.getByRole("heading", { name: "结果" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("inline")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
  });
});
