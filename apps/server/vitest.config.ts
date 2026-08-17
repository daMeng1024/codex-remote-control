import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@codex-remote/shared/codex",
        replacement: fileURLToPath(
          new URL("../../packages/shared/src/codex.ts", import.meta.url),
        ),
      },
      {
        find: "@codex-remote/shared",
        replacement: fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: { environment: "node" },
});
