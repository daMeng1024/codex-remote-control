import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  type AttachmentDto,
  type ImageMimeType,
} from "@codex-remote/shared";

const DEFAULT_ROOT = join(tmpdir(), "codex-remote-control", "uploads");
const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTENSION_BY_MIME: Record<ImageMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mimeType, extension]) => [
    extension,
    mimeType,
  ]),
) as Record<string, ImageMimeType>;

export class AttachmentError extends Error {
  readonly statusCode = 400;
}

function isImageMimeType(value: string): value is ImageMimeType {
  return ALLOWED_IMAGE_MIME_TYPES.includes(value as ImageMimeType);
}

function hasValidSignature(data: Buffer, mimeType: ImageMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return (
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff
    );
  }
  if (mimeType === "image/png") {
    return (
      data.length >= 8 &&
      data
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  );
}

function safeDisplayName(name: string | undefined, mimeType: ImageMimeType) {
  const cleaned = basename(name || `图片${EXTENSION_BY_MIME[mimeType]}`)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || `图片${EXTENSION_BY_MIME[mimeType]}`;
}

export interface StoredAttachment {
  id: string;
  path: string;
  mimeType: ImageMimeType;
}

export class AttachmentStore {
  private initialized = false;
  private readonly absoluteRoot: string;

  constructor(private readonly rootPath = DEFAULT_ROOT) {
    this.absoluteRoot = resolve(rootPath);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.absoluteRoot, { recursive: true, mode: 0o700 });
    await this.cleanupExpired();
    this.initialized = true;
  }

  async save(
    data: Buffer,
    contentType: string,
    displayName?: string,
  ): Promise<AttachmentDto> {
    await this.init();
    if (!isImageMimeType(contentType)) {
      throw new AttachmentError("仅支持 JPEG、PNG 和 WebP 图片。");
    }
    if (data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentError("图片大小必须在 1 字节到 10 MB 之间。");
    }
    if (!hasValidSignature(data, contentType)) {
      throw new AttachmentError("图片内容与文件类型不匹配。");
    }

    const id = randomUUID();
    const path = join(
      this.absoluteRoot,
      `${id}${EXTENSION_BY_MIME[contentType]}`,
    );
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return {
      id,
      name: safeDisplayName(displayName, contentType),
      mimeType: contentType,
      size: data.length,
      url: `/api/attachments/${id}`,
    };
  }

  async resolve(ids: string[] | undefined): Promise<StoredAttachment[]> {
    if (!ids?.length) return [];
    if (ids.length > MAX_ATTACHMENTS_PER_TURN) {
      throw new AttachmentError(
        `每次最多发送 ${MAX_ATTACHMENTS_PER_TURN} 张图片。`,
      );
    }
    if (new Set(ids).size !== ids.length) {
      throw new AttachmentError("图片附件不能重复。");
    }
    return Promise.all(ids.map((id) => this.find(id)));
  }

  async read(id: string): Promise<StoredAttachment & { data: Buffer }> {
    const attachment = await this.find(id);
    return { ...attachment, data: await readFile(attachment.path) };
  }

  publicUrlForPath(path: string): string | null {
    const absolutePath = resolve(path);
    if (dirname(absolutePath) !== this.absoluteRoot) return null;
    const id = basename(absolutePath, extname(absolutePath));
    const mimeType = MIME_BY_EXTENSION[extname(absolutePath).toLowerCase()];
    return UUID_PATTERN.test(id) && mimeType ? `/api/attachments/${id}` : null;
  }

  private async find(id: string): Promise<StoredAttachment> {
    await this.init();
    if (!UUID_PATTERN.test(id)) {
      throw new AttachmentError("图片附件标识无效。");
    }
    for (const [mimeType, extension] of Object.entries(EXTENSION_BY_MIME) as [
      ImageMimeType,
      string,
    ][]) {
      const path = join(this.absoluteRoot, `${id}${extension}`);
      try {
        const file = await stat(path);
        if (file.isFile() && file.size <= MAX_ATTACHMENT_BYTES) {
          return { id, path, mimeType };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new AttachmentError("图片附件不存在或已过期。");
  }

  private async cleanupExpired(): Promise<void> {
    const cutoff = Date.now() - ATTACHMENT_TTL_MS;
    const entries = await readdir(this.absoluteRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const extension = extname(entry.name).toLowerCase();
        const id = basename(entry.name, extension);
        if (!UUID_PATTERN.test(id) || !MIME_BY_EXTENSION[extension]) return;
        const path = join(this.absoluteRoot, entry.name);
        const file = await stat(path);
        if (file.mtimeMs < cutoff) await unlink(path);
      }),
    );
  }
}
