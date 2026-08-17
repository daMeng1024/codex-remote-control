import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginView } from "./LoginView";

describe("LoginView", () => {
  it("submits the entered access password", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => undefined);
    render(<LoginView onLogin={onLogin} />);

    await user.type(screen.getByLabelText("访问口令"), "long-access-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onLogin).toHaveBeenCalledWith("long-access-password");
  });

  it("shows a login failure without clearing the form", async () => {
    const user = userEvent.setup();
    render(
      <LoginView
        onLogin={async () => {
          throw new Error("口令错误");
        }}
      />,
    );

    const input = screen.getByLabelText("访问口令");
    await user.type(input, "wrong-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("口令错误");
    expect(input).toHaveValue("wrong-password");
  });
});
