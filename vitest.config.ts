import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // A git worktree under .claude/ is a second checkout of this same repo, so
    // vitest globs its test files too — but `@` below resolves to THIS root, so
    // the worktree's (older) tests run against the main tree's lib. That fails
    // for reasons that have nothing to do with either tree. Never collect them.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
