import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export class WorkspaceGuard {
  private rootRealPath: string | null = null;

  constructor(private readonly configuredRoot: string) {}

  async root(): Promise<string> {
    if (!this.rootRealPath) {
      this.rootRealPath = await realpath(this.configuredRoot);
    }
    return this.rootRealPath;
  }

  async assertAllowedDirectory(candidate: string): Promise<string> {
    if (!path.isAbsolute(candidate)) {
      throw new Error("工作目录必须是绝对路径。");
    }

    const [root, resolved] = await Promise.all([
      this.root(),
      realpath(candidate),
    ]);
    const resolvedStat = await stat(resolved);
    if (!resolvedStat.isDirectory()) {
      throw new Error("工作目录不存在或不是目录。");
    }

    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`工作目录必须位于 ${root} 内。`);
    }
    return resolved;
  }
}
