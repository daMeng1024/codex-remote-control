import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceGuard } from "./workspace.js";

const created: string[] = [];

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WorkspaceGuard", () => {
  it("accepts real directories beneath the configured root", async () => {
    const root = await tempDirectory("codex-workspace-");
    const child = path.join(root, "project");
    await mkdir(child);

    await expect(
      new WorkspaceGuard(root).assertAllowedDirectory(child),
    ).resolves.toBe(child);
  });

  it("rejects relative paths and files", async () => {
    const root = await tempDirectory("codex-workspace-");
    const file = path.join(root, "file.txt");
    await writeFile(file, "data");
    const guard = new WorkspaceGuard(root);

    await expect(guard.assertAllowedDirectory("relative")).rejects.toThrow(
      "绝对路径",
    );
    await expect(guard.assertAllowedDirectory(file)).rejects.toThrow(
      "不是目录",
    );
  });

  it("rejects traversal and symlinks that resolve outside the root", async () => {
    const root = await tempDirectory("codex-workspace-");
    const outside = await tempDirectory("codex-outside-");
    const escapedLink = path.join(root, "escaped");
    await symlink(outside, escapedLink);
    const guard = new WorkspaceGuard(root);

    await expect(guard.assertAllowedDirectory(outside)).rejects.toThrow(
      "必须位于",
    );
    await expect(guard.assertAllowedDirectory(escapedLink)).rejects.toThrow(
      "必须位于",
    );
  });
});
