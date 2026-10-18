import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export const DEFAULT_DENYLIST = [".env*", "*.pem", "*.key", "id_rsa*"];

// These checks are a warning system, not a guarantee that a patch contains no
// secrets. The sender should still review flagged changes before sharing.
const RULES: [string, RegExp][] = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  [
    "generic secret assignment",
    /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^\s"']{4,}/i,
  ],
  ["high-entropy credential", /\b[A-Za-z0-9/+_=-]{40,}\b/],
];
/** Load repository-specific blocked file patterns, or use safe defaults. */
export async function loadDenylist(root: string) {
  try {
    const config = JSON.parse(
      await readFile(join(root, ".changeshare.json"), "utf8"),
    );
    if (
      !Array.isArray(config.denylist) ||
      config.denylist.some(
        (p: unknown) => typeof p !== "string" || !p || p.includes("\0"),
      )
    )
      throw new Error("denylist must be an array of non-empty glob strings");
    return config.denylist as string[];
  } catch (e: any) {
    if (e.code === "ENOENT") return DEFAULT_DENYLIST;
    throw new Error(`Invalid .changeshare.json: ${e.message}`);
  }
}
function matches(pattern: string, path: string) {
  const name = basename(path);
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );
  return (
    regex.test(name) ||
    (pattern.includes("/") &&
      new RegExp(
        `^${pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
        "i",
      ).test(path))
  );
}
/** Return file names that match any configured denylist pattern. */
export function denied(files: string[], patterns = DEFAULT_DENYLIST) {
  return files.filter((f) => patterns.some((p) => matches(p, f)));
}
/** Find likely secrets in added lines and return messages that hide values. */
export function secrets(patch: Buffer) {
  const text = patch.toString("utf8");
  const findings: string[] = [];
  const paths = new Set<string>();
  for (const m of text.matchAll(/^(?:\+\+\+ b\/)([^\t\n]+)/gm)) paths.add(m[1]);
  for (const path of paths)
    if (basename(path).startsWith(".env"))
      findings.push(`${path}: env-style file`);
  // Only scan added lines: removed credentials are not being sent to the peer.
  for (const [label, rule] of RULES)
    for (const line of text.split("\n"))
      if (line.startsWith("+") && !line.startsWith("+++") && rule.test(line)) {
        findings.push(`${label} pattern (value hidden)`);
        break;
      }
  return [...new Set(findings)];
}
/** Create a short, human-readable one-time code for pairing computers. */
export function shareCode() {
  const colors = [
    "amber",
    "blue",
    "calm",
    "coral",
    "green",
    "indigo",
    "jade",
    "silver",
    "violet",
    "yellow",
  ];
  const animals = [
    "badger",
    "falcon",
    "gecko",
    "heron",
    "lynx",
    "otter",
    "panda",
    "tiger",
    "yak",
    "zebra",
  ];
  const b = randomBytes(3);
  return `${colors[b[0] % colors.length]}-${animals[b[1] % animals.length]}-${10 + (b[2] % 90)}`;
}
