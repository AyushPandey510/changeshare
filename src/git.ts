import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat as fsStat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const exec = promisify(execFile);

/** Run Git without a shell, so file paths and options stay separate arguments. */
export async function git(
  args: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = {},
) {
  try {
    return (
      await exec("git", args, {
        cwd,
        env: { ...process.env, ...env },
        maxBuffer: 120 * 1024 * 1024,
        encoding: null,
      })
    ).stdout as Buffer;
  } catch (e: any) {
    const detail = e.stderr?.toString().trim() || e.message;
    throw new Error(detail);
  }
}
/** Find the Git repository containing the current working directory. */
export async function repoRoot() {
  try {
    return (await git(["rev-parse", "--show-toplevel"])).toString().trim();
  } catch {
    throw new Error(
      "This folder isn't a git repository. Run from inside your project.",
    );
  }
}
/** Return the current commit ID for a repository. */
export async function head(cwd: string) {
  return (await git(["rev-parse", "HEAD"], cwd)).toString().trim();
}
export interface ChangeSet {
  /** Binary-safe patch that can be sent to another Git repository. */
  patch: Buffer;
  files: string[];
  statuses: Record<string, string>;
  added: number;
  removed: number;
  baseCommit: string;
}

/** Reject absolute paths and paths that would escape the repository root. */
function safePath(p: string, root: string) {
  if (!p || p.includes("\0") || isAbsolute(p)) return false;
  const abs = resolve(root, p);
  return abs === root || abs.startsWith(root + "/");
}
/** Create a patch from working-tree changes without changing the real index. */
export async function workingChanges(
  root: string,
  paths: string[] = [],
  includeIgnored = false,
  denylist = [".env*", "*.pem", "*.key", "id_rsa*"],
): Promise<ChangeSet> {
  // Build the patch with a temporary Git index. This leaves the user's real
  // staging area untouched, even though Git's `add` command is used below.
  const temp = await mkdtemp(join(tmpdir(), "changeshare-index-"));
  const index = join(temp, "index");
  try {
    const base = await head(root);
    await git(["read-tree", "HEAD"], root, { GIT_INDEX_FILE: index });
    let selected = paths;
    if (paths.length) {
      if (paths.some((p) => !safePath(p, root)))
        throw new Error("A selected path is outside the Git repository.");
      const tracked = new Set(
        (await git(["ls-files", "-z"], root))
          .toString()
          .split("\0")
          .filter(Boolean),
      );
      selected = [];
      for (const p of paths) {
        if (tracked.has(p)) {
          selected.push(p);
          continue;
        }
        try {
          await fsStat(resolve(root, p));
          selected.push(p);
        } catch {
          if ([...tracked].some((f) => f.startsWith(`${p}/`))) selected.push(p);
        }
      }
      if (!selected.length)
        return {
          patch: Buffer.alloc(0),
          files: [],
          statuses: {},
          added: 0,
          removed: 0,
          baseCommit: await head(root),
        };
    }
    const args = ["add", "-A"];
    if (includeIgnored) args.push("-f");
    args.push("--", ...(selected.length ? selected : ["."]));
    if (!includeIgnored)
      for (const pattern of denylist)
        args.push(`:(exclude,glob)**/${pattern}`, `:(exclude,glob)${pattern}`);
    await git(args, root, { GIT_INDEX_FILE: index });
    const patch = await git(
      ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "HEAD"],
      root,
      { GIT_INDEX_FILE: index },
    );
    // `-z` makes Git separate names with NUL bytes, so spaces and tabs in
    // filenames do not confuse the parser.
    const names = (
      await git(["diff", "--cached", "--name-only", "-z", "HEAD"], root, {
        GIT_INDEX_FILE: index,
      })
    )
      .toString()
      .split("\0")
      .filter(Boolean);
    if (names.some((p) => !safePath(p, root)))
      throw new Error("Git produced an unsafe path in the patch.");
    const statuses = Object.fromEntries(names.map((p) => [p, "modified"]));
    const statusTokens = (
      await git(["diff", "--cached", "--name-status", "-z", "HEAD"], root, {
        GIT_INDEX_FILE: index,
      })
    )
      .toString()
      .split("\0")
      .filter(Boolean);
    for (let i = 0; i < statusTokens.length;) {
      const kind = statusTokens[i++];
      const first = statusTokens[i++];
      if (kind.startsWith("R") || kind.startsWith("C")) {
        const to = statusTokens[i++];
        statuses[to] = kind.startsWith("R") ? "renamed" : "copied";
      } else
        statuses[first] =
          (
            {
              A: "added",
              D: "deleted",
              M: "modified",
              T: "type-changed",
            } as Record<string, string>
          )[kind] || "modified";
    }
    const stat = await git(
      ["diff", "--cached", "--numstat", "-z", "HEAD"],
      root,
      { GIT_INDEX_FILE: index },
    );
    let added = 0,
      removed = 0;
    for (const line of stat.toString().split("\0")) {
      const [a, d] = line.split("\t");
      if (/^\d+$/.test(a)) added += Number(a);
      if (/^\d+$/.test(d)) removed += Number(d);
    }
    return { patch, files: names, statuses, added, removed, baseCommit: base };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
/** Read a stash and return it in the same shape as working-tree changes. */
export async function stashChanges(root: string, ref?: string) {
  // Resolve the stash to a commit ID first so later Git commands always refer
  // to the same stash even if the stash list changes during the operation.
  const chosen = ref || "stash@{0}";
  const resolved = (await git(["rev-parse", "--verify", chosen], root))
    .toString()
    .trim();
  const patch = await git(
    [
      "stash",
      "show",
      "-p",
      "--binary",
      "--full-index",
      "--include-untracked",
      resolved,
    ],
    root,
  );
  const files = (
    await git(
      ["stash", "show", "--name-only", "--include-untracked", resolved],
      root,
    )
  )
    .toString()
    .split("\n")
    .filter(Boolean);
  const statuses = Object.fromEntries(files.map((f) => [f, "modified"]));
  const statusTokens = (
    await git(
      ["diff-tree", "-r", "--name-status", "-z", `${resolved}^1`, resolved],
      root,
    )
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  for (let i = 0; i < statusTokens.length;) {
    const kind = statusTokens[i++];
    const first = statusTokens[i++];
    if (kind.startsWith("R") || kind.startsWith("C")) {
      const to = statusTokens[i++];
      statuses[to] = kind.startsWith("R") ? "renamed" : "copied";
    } else
      statuses[first] =
        (
          {
            A: "added",
            D: "deleted",
            M: "modified",
            T: "type-changed",
          } as Record<string, string>
        )[kind] || "modified";
  }
  const stat = (
    await git(
      ["stash", "show", "--numstat", "--include-untracked", resolved],
      root,
    )
  ).toString();
  let added = 0,
    removed = 0;
  for (const line of stat.split("\n")) {
    const [a, d] = line.split("\t");
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) removed += Number(d);
  }
  const baseCommit = (await git(["rev-parse", `${resolved}^1`], root))
    .toString()
    .trim();
  return { patch, files, statuses, added, removed, baseCommit };
}
/** Create a patch containing the selected commit's changes. */
export async function commitChanges(
  root: string,
  ref: string,
): Promise<ChangeSet> {
  // Send the commit's difference from its parent, not the entire repository.
  if (!ref || ref.startsWith("-") || ref.includes("\0"))
    throw new Error("Provide a valid commit reference.");
  const commit = (await git(["rev-parse", "--verify", `${ref}^{commit}`], root))
    .toString()
    .trim();
  let baseCommit: string;
  try {
    baseCommit = (await git(["rev-parse", "--verify", `${commit}^`], root))
      .toString()
      .trim();
  } catch {
    baseCommit = (await git(["hash-object", "-t", "tree", "/dev/null"], root))
      .toString()
      .trim();
  }
  const patch = await git(
    ["diff", "--binary", "--full-index", "--no-ext-diff", baseCommit, commit],
    root,
  );
  const files = (
    await git(["diff", "--name-only", "-z", baseCommit, commit], root)
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const statuses = Object.fromEntries(files.map((file) => [file, "modified"]));
  const statusTokens = (
    await git(["diff", "--name-status", "-z", baseCommit, commit], root)
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  for (let i = 0; i < statusTokens.length;) {
    const kind = statusTokens[i++];
    const first = statusTokens[i++];
    if (kind.startsWith("R") || kind.startsWith("C")) {
      const to = statusTokens[i++];
      statuses[to] = kind.startsWith("R") ? "renamed" : "copied";
    } else
      statuses[first] =
        (
          {
            A: "added",
            D: "deleted",
            M: "modified",
            T: "type-changed",
          } as Record<string, string>
        )[kind] || "modified";
  }
  const stat = await git(["diff", "--numstat", "-z", baseCommit, commit], root);
  let added = 0,
    removed = 0;
  for (const line of stat.toString().split("\0")) {
    const [a, d] = line.split("\t");
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) removed += Number(d);
  }
  return { patch, files, statuses, added, removed, baseCommit };
}
/** Check and/or apply a patch, optionally using three-way or reject mode. */
export async function applyPatch(
  root: string,
  patch: Buffer,
  threeWay = false,
  dryRun = false,
  reverse = false,
  reject = false,
) {
  // Keep patch data out of shell commands and pass Git a private temporary file.
  const temp = await mkdtemp(join(tmpdir(), "changeshare-patch-"));
  const file = join(temp, "incoming.patch");
  try {
    await writeFile(file, patch, { mode: 0o600 });
    // Check paths before handing the patch to git.
    const text = patch.toString("utf8");
    for (const m of text.matchAll(/^(?:\+\+\+|---) [ab]\/([^\t\n]+)/gm))
      if (!safePath(m[1], root)) throw new Error(`Unsafe patch path: ${m[1]}`);
    if (!reject) {
      const checkArgs = ["apply", "--check"];
      if (threeWay) checkArgs.push("--3way");
      if (reverse) checkArgs.push("--reverse");
      checkArgs.push(file);
      await git(checkArgs, root);
    }
    if (!dryRun) {
      const applyArgs = ["apply", "--binary"];
      if (threeWay) applyArgs.push("--3way");
      if (reverse) applyArgs.push("--reverse");
      if (reject) applyArgs.push("--reject");
      applyArgs.push(file);
      try {
        await git(applyArgs, root);
      } catch (e) {
        if (!reject) throw e;
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
/** Return whether the repository has staged or unstaged changes. */
export async function localChanges(root: string) {
  return (
    (await git(["status", "--porcelain"], root)).toString().trim().length > 0
  );
}
/** Save a reverse patch so the latest transfer can be undone later. */
export async function makeUndo(root: string, patch: Buffer) {
  // Store only the patch created by this transfer inside Git's own metadata
  // directory; this does not add files to the user's working tree.
  const dir = (await git(["rev-parse", "--git-path", "changeshare"], root))
    .toString()
    .trim();
  const absolute = isAbsolute(dir) ? dir : join(root, dir);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const undo = join(absolute, `undo-${Date.now()}.patch`);
  await writeFile(undo, patch, { mode: 0o600 });
  await writeFile(join(absolute, "latest"), `${undo.split("/").at(-1)}\n`, {
    mode: 0o600,
  });
}
/** Apply and remove the undo patch created by the latest transfer. */
export async function undo(root: string) {
  const dir = (await git(["rev-parse", "--git-path", "changeshare"], root))
    .toString()
    .trim();
  const absolute = isAbsolute(dir) ? dir : join(root, dir);
  const filename = (await readFile(join(absolute, "latest"), "utf8")).trim();
  if (!/^undo-\d+\.patch$/.test(filename))
    throw new Error("Undo record is invalid.");
  const target = join(absolute, filename);
  const reverse = await readFile(target);
  await applyPatch(root, reverse, false, false, true);
  await rm(target, { force: true });
  await rm(join(absolute, "latest"), { force: true });
}
