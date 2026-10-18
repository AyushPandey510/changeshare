const vscode = require("vscode");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/AyushPandey510/changeshare/main/install.sh | bash";

function executableCandidates() {
  const configured = vscode.workspace
    .getConfiguration("changeshare")
    .get("executablePath");
  return [
    configured,
    "changeshare",
    path.join(os.homedir(), ".local", "bin", "changeshare"),
  ].filter(Boolean);
}

function checkExecutable(candidate) {
  return new Promise((resolve) => {
    execFile(candidate, ["--version"], { timeout: 5000 }, (error, stdout) => {
      resolve(
        error ? null : { command: candidate, version: String(stdout).trim() },
      );
    });
  });
}

async function findExecutable() {
  for (const candidate of executableCandidates()) {
    const result = await checkExecutable(candidate);
    if (result) return result;
  }
  return null;
}

async function chooseWorkspace() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    vscode.window.showWarningMessage(
      "Open a Git project folder before using ChangeShare.",
    );
    return null;
  }
  if (folders.length === 1) return folders[0];
  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Choose the project to use with ChangeShare" },
  );
  return selected && selected.folder;
}

let selectedWorkspace;
function currentWorkspace() {
  return (
    selectedWorkspace || (vscode.workspace.workspaceFolders || [])[0] || null
  );
}

// The sidebar reads Git directly so it can show file status, stash messages,
// and commit subjects without duplicating the CLI's transfer logic.
function gitOutput(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim()));
        else resolve(stdout);
      },
    );
  });
}

class TreeProvider {
  constructor(kind) {
    this.kind = kind;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }
  refresh() {
    this.changed.fire(undefined);
  }
  getTreeItem(item) {
    return item;
  }
  async getChildren() {
    if (this.kind === "actions") {
      return [
        ["Share Changes…", "changeshare.share"],
        ["Receive Changes", "changeshare.receive"],
        ["Undo Last Transfer", "changeshare.undo"],
        ["Check LAN Connection", "changeshare.doctor"],
        ["Choose Project", "changeshare.selectWorkspace"],
      ].map(([label, command]) => {
        const item = new vscode.TreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.command = { command, title: label };
        return item;
      });
    }
    const folder = currentWorkspace();
    if (!folder)
      return [new vscode.TreeItem("Open a project folder to get started")];
    const root = folder.uri.fsPath;
    try {
      // Keep the tree views focused: each provider asks Git only for the data
      // needed by its corresponding sidebar list.
      if (this.kind === "changes") {
        const raw = (
          await gitOutput(
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            root,
          )
        ).toString();
        const entries = raw.split("\0").filter(Boolean);
        const items = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const status = entry.slice(0, 2).trim() || "??";
          const file = entry.slice(3);
          if (status.includes("R") || status.includes("C")) i++;
          const item = new vscode.TreeItem(
            file,
            vscode.TreeItemCollapsibleState.None,
          );
          item.description = status;
          item.tooltip = `${status}  ${file}`;
          item.contextValue = "changeshareChange";
          item.file = file;
          item.resourceUri = vscode.Uri.file(path.join(root, file));
          item.command = {
            command: "vscode.open",
            title: "Open changed file",
            arguments: [item.resourceUri],
          };
          items.push(item);
        }
        return items.length
          ? items
          : [new vscode.TreeItem("Working tree is clean")];
      }
      if (this.kind === "stashes") {
        const raw = (
          await gitOutput(["stash", "list", "--format=%gd%x09%gs"], root)
        )
          .toString()
          .trim();
        if (!raw) return [new vscode.TreeItem("No stashes in this project")];
        return raw.split("\n").map((line) => {
          const [ref, ...message] = line.split("\t");
          const item = new vscode.TreeItem(
            ref,
            vscode.TreeItemCollapsibleState.None,
          );
          item.description = message.join("\t");
          item.tooltip = `${ref}: ${item.description}`;
          item.contextValue = "changeshareStash";
          item.ref = ref;
          item.command = {
            command: "changeshare.shareStash",
            title: "Share Stash",
            arguments: [item],
          };
          return item;
        });
      }
      const raw = (
        await gitOutput(["log", "-20", "--format=%H%x09%h%x09%an%x09%s"], root)
      )
        .toString()
        .trim();
      if (!raw) return [new vscode.TreeItem("No commits in this project")];
      return raw.split("\n").map((line) => {
        const [hash, short, author, ...subject] = line.split("\t");
        const item = new vscode.TreeItem(
          subject.join("\t") || "(no subject)",
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = `${short} · ${author}`;
        item.tooltip = `${hash}\n${item.label}\n${author}`;
        item.contextValue = "changeshareCommit";
        item.hash = hash;
        item.command = {
          command: "changeshare.shareCommit",
          title: "Share Commit",
          arguments: [item],
        };
        return item;
      });
    } catch (error) {
      const item = new vscode.TreeItem(
        `Could not load ${this.kind}: ${error.message}`,
      );
      item.contextValue = "changeshareError";
      return [item];
    }
  }
}

async function requireLinux() {
  if (process.platform === "linux") return true;
  await vscode.window.showErrorMessage(
    "ChangeShare currently provides Linux CLI binaries. macOS and Windows support is not available yet.",
  );
  return false;
}

async function ensureCli() {
  const found = await findExecutable();
  if (found) return found.command;

  const choice = await vscode.window.showWarningMessage(
    "ChangeShare CLI is not installed. Install it to use the extension.",
    "Install ChangeShare",
  );
  if (choice === "Install ChangeShare") {
    const channel = getOutputChannel();
    channel.show(true);
    channel.appendLine("Installing the ChangeShare CLI...");
    const installed = await runInstaller(channel);
    if (installed) {
      vscode.window.showInformationMessage(
        "ChangeShare CLI installed. Run the command again to continue.",
      );
      return await findExecutable().then((result) => result && result.command);
    }
    await vscode.window.showErrorMessage(
      "CLI installation failed. See Output > ChangeShare for details.",
    );
  }
  return null;
}

async function run(command, args, title, selectedFolder) {
  if (!(await requireLinux())) return;
  const folder = selectedFolder || (await chooseWorkspace());
  if (!folder) return;
  const binary = await ensureCli();
  if (!binary) return;
  const commandArgs = [...args];
  if (
    (command === "send" || command === "receive") &&
    !commandArgs.includes("--port")
  ) {
    const configuredPort = Number(
      vscode.workspace.getConfiguration("changeshare").get("defaultPort", 8765),
    );
    if (
      Number.isInteger(configuredPort) &&
      configuredPort >= 1 &&
      configuredPort <= 65535
    )
      commandArgs.push("--port", String(configuredPort));
  }
  await runCli(binary, command, commandArgs, folder.uri.fsPath, title);
}

let operationStatus;
let outputChannel;
let changeProvider;
let stashProvider;
let commitProvider;
let changeTree;
function getOutputChannel() {
  if (!outputChannel)
    outputChannel = vscode.window.createOutputChannel("ChangeShare");
  return outputChannel;
}

function setBusy(title) {
  if (!operationStatus) return;
  operationStatus.text = `$(sync~spin) ${title}`;
  operationStatus.tooltip = "ChangeShare is running in the background";
  operationStatus.show();
}

function clearBusy() {
  if (operationStatus) operationStatus.hide();
}

async function runInstaller(channel) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", INSTALL_COMMAND], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => channel.append(data.toString()));
    child.stderr.on("data", (data) => channel.append(data.toString()));
    child.once("error", (error) => {
      channel.appendLine(`Installer could not start: ${error.message}`);
      resolve(false);
    });
    child.once("close", (code) => resolve(code === 0));
  });
}

function senderChoices(output) {
  const choices = [];
  const pattern = /^\s*(\d+)\.\s*(.*?)\s+—\s+(.*?)\s+\(([^)]+)\)\s*$/gm;
  for (const match of output.matchAll(pattern))
    choices.push({
      label: match[2],
      description: `${match[3]} (${match[4]})`,
      value: match[1],
    });
  return choices;
}

async function answerPrompt(marker, output) {
  const modal = async (message, detail, accept, reject) => {
    const selected = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      accept,
      reject,
    );
    return selected === accept ? "y" : "n";
  };
  if (marker.startsWith("Allow?")) {
    const receiver =
      output.match(/([^\n]+) wants to receive\./)?.[1] ||
      "A receiver wants to receive.";
    return modal("Allow this receiver?", receiver, "Allow", "Reject");
  }
  if (marker.startsWith("Review the patch"))
    return modal(
      "Potential secrets were found.",
      "Review the ChangeShare output and patch before continuing.",
      "Continue sending",
      "Cancel",
    );
  if (marker.startsWith("Send?"))
    return modal(
      "Send these changes?",
      "The file list and secret scan are shown in the ChangeShare output.",
      "Send",
      "Cancel",
    );
  if (marker.startsWith("Your working tree"))
    return modal(
      "Your working tree has changes.",
      "Stash tracked and untracked changes before receiving?",
      "Stash and continue",
      "Cancel",
    );
  if (marker.startsWith("Choose a sender number:")) {
    const choices = senderChoices(output);
    if (!choices.length)
      return (
        (await vscode.window.showInputBox({
          prompt: "Enter the number of the sender to connect to",
        })) || ""
      );
    const selected = await vscode.window.showQuickPick(choices, {
      placeHolder: "Choose a sender by Git name and hostname",
      ignoreFocusOut: true,
    });
    return selected?.value || "";
  }
  if (marker.startsWith("Apply these changes?"))
    return modal(
      "Apply the incoming changes?",
      "Review the file list in the ChangeShare output.",
      "Apply",
      "Cancel",
    );
  if (marker.startsWith("Try a three-way apply?"))
    return modal(
      "Try a three-way apply?",
      "The sender and receiver have different base commits.",
      "Try three-way",
      "Cancel",
    );
  if (marker.startsWith("Choose:")) {
    const selected = await vscode.window.showQuickPick(
      [
        { label: "Three-way apply", value: "3" },
        { label: "Apply clean hunks and write .rej files", value: "r" },
        { label: "Abort", value: "a" },
      ],
      {
        placeHolder: "Choose how to handle the patch conflict",
        ignoreFocusOut: true,
      },
    );
    return selected?.value || "a";
  }
  return "n";
}

async function runCli(binary, command, args, cwd, title) {
  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`\n${title}`);
  channel.appendLine(`Action: ${title}`);
  setBusy(title);
  const child = spawn(binary, [command, ...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let recentOutput = "";
  let handlingPrompt = false;
  let startError = false;
  // The CLI remains the source of truth for prompts. Translate its known
  // prompt text into native VS Code dialogs and send the answer back on stdin.
  const markers = [
    "Review the patch and confirm these findings are safe to share? [y/N]",
    "Your working tree has local changes. Stash tracked and untracked changes before receiving? [y/N]",
    "Try a three-way apply? [Y/n]",
    "Apply these changes? [Y/n]",
    "Choose a sender number:",
    "Choose: [3] three-way, [r] apply clean hunks and write .rej files, [a] abort:",
    "Allow? [y/N]",
    "Send? [Y/n]",
  ];
  const scan = () => {
    if (handlingPrompt) return;
    let found;
    for (const marker of markers) {
      const index = buffer.indexOf(marker);
      if (index >= 0 && (!found || index < found.index))
        found = { marker, index };
    }
    if (!found) {
      if (buffer.length > 20_000) buffer = buffer.slice(-20_000);
      return;
    }
    buffer = buffer.slice(found.index + found.marker.length);
    handlingPrompt = true;
    void answerPrompt(found.marker, recentOutput)
      .then((answer) => {
        child.stdin.write(`${answer}\n`);
        handlingPrompt = false;
        scan();
      })
      .catch((error) => {
        channel.appendLine(`Prompt failed: ${error.message}`);
        child.stdin.write("n\n");
        handlingPrompt = false;
        scan();
      });
  };
  child.stdout.on("data", (data) => {
    const text = data.toString();
    channel.append(text);
    recentOutput = (recentOutput + text).slice(-20_000);
    buffer += text;
    scan();
  });
  child.stderr.on("data", (data) => channel.append(data.toString()));
  child.once("error", (error) => {
    startError = true;
    clearBusy();
    channel.appendLine(`Could not start ChangeShare: ${error.message}`);
    void vscode.window.showErrorMessage(
      `Could not start ChangeShare. See Output > ChangeShare for details.`,
    );
  });
  child.once("close", (code) => {
    clearBusy();
    child.stdin.end();
    refreshViews();
    if (startError) return;
    if (code === 0)
      vscode.window.showInformationMessage(
        `${title} finished. See Output > ChangeShare for details.`,
      );
    else
      vscode.window.showErrorMessage(
        `${title} did not complete successfully. See Output > ChangeShare for details.`,
      );
  });
}

async function share() {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Current changes",
        description: "Review the file list and send",
        args: [],
      },
      {
        label: "Preview current changes",
        description: "Show the patch before sending",
        args: ["--preview"],
      },
      {
        label: "Latest stash",
        description: "Share stash@{0}",
        args: ["--stash"],
      },
      {
        label: "Choose a stash",
        description: "Enter a stash reference such as stash@{1}",
        stash: true,
      },
    ],
    { placeHolder: "What would you like to share?" },
  );
  if (!choice) return;
  let args = choice.args;
  if (choice.stash) {
    const ref = await vscode.window.showInputBox({
      prompt: "Enter a stash reference",
      value: "stash@{0}",
      validateInput: (value) =>
        /^stash@\{\d+\}$/.test(value)
          ? null
          : "Use a reference like stash@{0}.",
    });
    if (!ref) return;
    args = ["--stash", ref];
  }
  await run("send", args, "ChangeShare: Send");
}

async function shareAllChanges() {
  const folder = currentWorkspace() || (await chooseWorkspace());
  if (!folder) return;
  selectedWorkspace = folder;
  await sendWithMode([], "ChangeShare: Share All Changes", folder);
}

async function shareSelectedChanges() {
  const selected = changeTree?.selection || [];
  const files = selected.filter((item) => item.file).map((item) => item.file);
  if (!files.length) {
    await vscode.window.showInformationMessage(
      "Select one or more files in the Working Changes list first.",
    );
    return;
  }
  const folder = currentWorkspace();
  if (!folder) return;
  await sendWithMode(files, "ChangeShare: Share Selected Changes", folder);
}

async function shareStash(item) {
  const folder = currentWorkspace() || (await chooseWorkspace());
  if (folder && item?.ref)
    await sendWithMode(
      ["--stash", item.ref],
      `ChangeShare: Share ${item.ref}`,
      folder,
    );
}

async function shareCommit(item) {
  const folder = currentWorkspace() || (await chooseWorkspace());
  if (folder && item?.hash)
    await sendWithMode(
      ["--commit", item.hash],
      "ChangeShare: Share Commit",
      folder,
    );
}

async function sendWithMode(args, title, folder) {
  const mode = await vscode.window.showQuickPick(
    [
      { label: "Review summary before sending", args: [] },
      { label: "Preview patch before sending", args: ["--preview"] },
    ],
    { placeHolder: "Choose how to review these changes" },
  );
  if (mode) await run("send", [...args, ...mode.args], title, folder);
}

async function selectWorkspace() {
  const folder = await chooseWorkspace();
  if (!folder) return;
  selectedWorkspace = folder;
  refreshViews();
  await vscode.window.showInformationMessage(
    `ChangeShare project: ${folder.name}`,
  );
}

function refreshViews() {
  changeProvider?.refresh();
  stashProvider?.refresh();
  commitProvider?.refresh();
}

async function receive() {
  const code = await vscode.window.showInputBox({
    prompt: "Enter the share code shown on the sender’s computer",
    placeHolder: "blue-tiger-42",
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[a-z]+-[a-z]+-\d{2}$/.test(value.trim())
        ? null
        : "Enter a code in the format blue-tiger-42.",
  });
  if (!code) return;
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: "Review then apply",
        description: "Show changed files and ask before applying",
        args: [],
      },
      {
        label: "Preview patch then review",
        description: "Print the patch before the apply prompt",
        args: ["--preview"],
      },
      {
        label: "Dry run only",
        description: "Check whether the patch applies without changing files",
        args: ["--dry-run"],
      },
    ],
    { placeHolder: "How would you like to receive these changes?" },
  );
  if (!mode) return;
  await run("receive", [code.trim(), ...mode.args], "ChangeShare: Receive");
}

async function undo() {
  const folder = await chooseWorkspace();
  if (!folder) return;
  const choice = await vscode.window.showWarningMessage(
    `Undo the latest ChangeShare transfer in “${folder.name}”?`,
    {
      modal: true,
      detail:
        "This reverses the most recently applied transfer in this project.",
    },
    "Undo Transfer",
  );
  if (choice === "Undo Transfer")
    await run("undo", [], "ChangeShare: Undo", folder);
}

function activate(context) {
  changeProvider = new TreeProvider("changes");
  stashProvider = new TreeProvider("stashes");
  commitProvider = new TreeProvider("commits");
  const actionProvider = new TreeProvider("actions");
  const changesView = vscode.window.createTreeView("changeshare.changes", {
    treeDataProvider: changeProvider,
    canSelectMany: true,
  });
  const stashesView = vscode.window.createTreeView("changeshare.stashes", {
    treeDataProvider: stashProvider,
  });
  const commitsView = vscode.window.createTreeView("changeshare.commits", {
    treeDataProvider: commitProvider,
  });
  const actionsView = vscode.window.createTreeView("changeshare.actions", {
    treeDataProvider: actionProvider,
  });
  changeTree = changesView;
  if (!selectedWorkspace)
    selectedWorkspace = (vscode.workspace.workspaceFolders || [])[0];
  const shareButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  shareButton.text = "$(broadcast) Share Changes";
  shareButton.tooltip = "Share Git changes with ChangeShare";
  shareButton.command = "changeshare.share";
  shareButton.show();
  operationStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  outputChannel = getOutputChannel();
  context.subscriptions.push(
    operationStatus,
    outputChannel,
    changesView,
    stashesView,
    commitsView,
    actionsView,
  );
  context.subscriptions.push(
    shareButton,
    // Git changes can come from the integrated terminal or another process, so
    // VS Code's document events do not cover every update. Poll the Git-backed
    // trees so working changes, stashes, and commits stay current.
    new vscode.Disposable(setInterval(refreshViews, 2000)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (
        !selectedWorkspace ||
        !(vscode.workspace.workspaceFolders || []).some(
          (folder) =>
            folder.uri.toString() === selectedWorkspace.uri.toString(),
        )
      )
        selectedWorkspace = (vscode.workspace.workspaceFolders || [])[0];
      refreshViews();
    }),
    vscode.commands.registerCommand("changeshare.share", share),
    vscode.commands.registerCommand("changeshare.shareAll", shareAllChanges),
    vscode.commands.registerCommand(
      "changeshare.shareSelected",
      shareSelectedChanges,
    ),
    vscode.commands.registerCommand("changeshare.shareStash", shareStash),
    vscode.commands.registerCommand("changeshare.shareCommit", shareCommit),
    vscode.commands.registerCommand("changeshare.refresh", refreshViews),
    vscode.commands.registerCommand(
      "changeshare.selectWorkspace",
      selectWorkspace,
    ),
    vscode.commands.registerCommand("changeshare.receive", receive),
    vscode.commands.registerCommand("changeshare.undo", undo),
    vscode.commands.registerCommand("changeshare.doctor", () =>
      run("doctor", [], "ChangeShare: Doctor"),
    ),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
