import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttachmentStore } from "./attachment-store.js";

const roots: string[] = [];
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function store() {
  const root = await mkdtemp(join(tmpdir(), "codex-attachment-test-"));
  roots.push(root);
  return new AttachmentStore(root);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AttachmentStore", () => {
  it("stores validated images with private permissions and opaque URLs", async () => {
    const attachments = await store();
    const uploaded = await attachments.save(
      pngHeader,
      "image/png",
      "../手机截图.png",
    );
    const [resolved] = await attachments.resolve([uploaded.id]);

    expect(uploaded).toMatchObject({
      name: "手机截图.png",
      mimeType: "image/png",
      size: pngHeader.length,
      url: `/api/attachments/${uploaded.id}`,
    });
    expect((await stat(resolved!.path)).mode & 0o777).toBe(0o600);
    expect(attachments.publicUrlForPath(resolved!.path)).toBe(uploaded.url);
    await expect(attachments.read(uploaded.id)).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });

  it("rejects spoofed images and unknown attachment ids", async () => {
    const attachments = await store();

    await expect(
      attachments.save(Buffer.from("not an image"), "image/png"),
    ).rejects.toThrow("文件类型不匹配");
    await expect(
      attachments.resolve(["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toThrow("不存在或已过期");
    expect(attachments.publicUrlForPath("/home/epean/private.png")).toBeNull();
  });
});
