import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args, cwd = root) =>
  execFileSync("git", args, { cwd, stdio: "inherit", windowsHide: true });

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "basamgi-production-"));
let worktreeAdded = false;

try {
  run(["worktree", "add", "--detach", temporaryDirectory, "production"]);
  worktreeAdded = true;
  run(["merge", "--no-edit", "main"], temporaryDirectory);

  const mergedHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const oldProduction = execFileSync("git", ["rev-parse", "refs/heads/production"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();

  run(["update-ref", "refs/heads/production", mergedHead, oldProduction]);
  run(["push", "origin", "production"]);
} finally {
  if (worktreeAdded) {
    try {
      run(["worktree", "remove", "--force", temporaryDirectory]);
    } catch (error) {
      console.error(`Could not remove temporary worktree at ${temporaryDirectory}`);
      throw error;
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
