import { expect, test } from "@playwright/test";

test("login, live message, approval, reconnect, and responsive layout", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("访问口令").fill("codex-e2e-password");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(
    page.getByRole("navigation", { name: "会话列表" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /远程工作台验收/ }).click();
  await expect(page.getByRole("heading", { name: "准备就绪" })).toBeVisible();
  await page.getByRole("button", { name: "重新编辑这条指令" }).click();
  await expect(page.getByLabel("发送消息")).toHaveValue("检查移动端渲染");

  await page.getByLabel("发送消息").fill("运行测试");
  await page.getByLabel("选择图片").setInputFiles({
    name: "mobile-screen.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByRole("img", { name: "mobile-screen.png" }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/playwright/${testInfo.project.name}-image-draft.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("已收到：运行测试")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "待处理请求" })).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }));
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.bodyHeight).toBeLessThanOrEqual(dimensions.viewportHeight);
  await page.screenshot({
    path: `output/playwright/${testInfo.project.name}-approval.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByRole("dialog", { name: "待处理请求" })).toBeHidden();

  const restartResponse = await page.request.post("/__e2e/restart-events");
  expect(restartResponse.ok()).toBe(true);
  await expect(page.getByText("实时连接正在恢复")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("实时连接正在恢复")).toBeHidden({
    timeout: 15_000,
  });
});
