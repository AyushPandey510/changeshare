const vscode = require('vscode');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/AyushPandey510/changeshare/main/install.sh | bash';

function executableCandidates() {
  const configured = vscode.workspace.getConfiguration('changeshare').get('executablePath');
  return [configured, 'changeshare', path.join(os.homedir(), '.local', 'bin', 'changeshare')].filter(Boolean);
}

function checkExecutable(candidate) {
  return new Promise(resolve => {
    execFile(candidate, ['--version'], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : { command: candidate, version: String(stdout).trim() });
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
    vscode.window.showWarningMessage('Open a Git project folder before using ChangeShare.');
    return null;
  }
  if (folders.length === 1) return folders[0];
  const selected = await vscode.window.showQuickPick(
    folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { placeHolder: 'Choose the project to use with ChangeShare' }
  );
  return selected && selected.folder;
}

function quoteShell(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

async function requireLinux() {
  if (process.platform === 'linux') return true;
  await vscode.window.showErrorMessage('ChangeShare currently provides Linux CLI binaries. macOS and Windows support is not available yet.');
  return false;
}

async function ensureCli() {
  const found = await findExecutable();
  if (found) return found.command;

  const choice = await vscode.window.showWarningMessage(
    'ChangeShare CLI is not installed. Install it to use the extension.',
    'Install ChangeShare'
  );
  if (choice === 'Install ChangeShare') {
    const terminal = vscode.window.createTerminal({ name: 'Install ChangeShare' });
    terminal.show(true);
    terminal.sendText(INSTALL_COMMAND, true);
    vscode.window.showInformationMessage('After installation, run the ChangeShare command again. The extension also checks ~/.local/bin directly.');
  }
  return null;
}

async function run(command, args, title, selectedFolder) {
  if (!await requireLinux()) return;
  const folder = selectedFolder || await chooseWorkspace();
  if (!folder) return;
  const binary = await ensureCli();
  if (!binary) return;
  const commandArgs = [...args];
  if ((command === 'send' || command === 'receive') && !commandArgs.includes('--port')) {
    const configuredPort = Number(vscode.workspace.getConfiguration('changeshare').get('defaultPort', 8765));
    if (Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535) commandArgs.push('--port', String(configuredPort));
  }
  const terminal = vscode.window.createTerminal({ name: title, cwd: folder.uri.fsPath });
  activeTerminals.add(terminal);
  updateOperationStatus();
  terminal.show(true);
  terminal.sendText([binary, command, ...commandArgs].map(quoteShell).join(' '), true);
}

const activeTerminals = new Set();
let operationStatus;
function updateOperationStatus() {
  if (!operationStatus) return;
  if (activeTerminals.size) {
    operationStatus.text = '$(terminal) ChangeShare Terminal';
    operationStatus.tooltip = 'A ChangeShare command is open in an integrated terminal';
    operationStatus.show();
  } else operationStatus.hide();
}

async function share() {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Current changes', description: 'Review the file list and send', args: [] },
      { label: 'Preview current changes', description: 'Show the patch before sending', args: ['--preview'] },
      { label: 'Latest stash', description: 'Share stash@{0}', args: ['--stash'] },
      { label: 'Choose a stash', description: 'Enter a stash reference such as stash@{1}', stash: true }
    ],
    { placeHolder: 'What would you like to share?' }
  );
  if (!choice) return;
  let args = choice.args;
  if (choice.stash) {
    const ref = await vscode.window.showInputBox({
      prompt: 'Enter a stash reference',
      value: 'stash@{0}',
      validateInput: value => /^stash@\{\d+\}$/.test(value) ? null : 'Use a reference like stash@{0}.'
    });
    if (!ref) return;
    args = ['--stash', ref];
  }
  await run('send', args, 'ChangeShare: Send');
}

async function receive() {
  const code = await vscode.window.showInputBox({
    prompt: 'Enter the share code shown on the sender’s computer',
    placeHolder: 'blue-tiger-42',
    ignoreFocusOut: true,
    validateInput: value => /^[a-z]+-[a-z]+-\d{2}$/.test(value.trim()) ? null : 'Enter a code in the format blue-tiger-42.'
  });
  if (!code) return;
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'Review then apply', description: 'Show changed files and ask before applying', args: [] },
      { label: 'Preview patch then review', description: 'Print the patch before the apply prompt', args: ['--preview'] },
      { label: 'Dry run only', description: 'Check whether the patch applies without changing files', args: ['--dry-run'] }
    ],
    { placeHolder: 'How would you like to receive these changes?' }
  );
  if (!mode) return;
  await run('receive', [code.trim(), ...mode.args], 'ChangeShare: Receive');
}

async function undo() {
  const folder = await chooseWorkspace();
  if (!folder) return;
  const choice = await vscode.window.showWarningMessage(
    `Undo the latest ChangeShare transfer in “${folder.name}”?`,
    { modal: true, detail: 'This reverses the most recently applied transfer in this project.' },
    'Undo Transfer'
  );
  if (choice === 'Undo Transfer') await run('undo', [], 'ChangeShare: Undo', folder);
}

function activate(context) {
  const shareButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  shareButton.text = '$(broadcast) Share Changes';
  shareButton.tooltip = 'Share Git changes with ChangeShare';
  shareButton.command = 'changeshare.share';
  shareButton.show();
  operationStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  context.subscriptions.push(operationStatus, vscode.window.onDidCloseTerminal(terminal => {
    activeTerminals.delete(terminal);
    updateOperationStatus();
  }));
  context.subscriptions.push(
    shareButton,
    vscode.commands.registerCommand('changeshare.share', share),
    vscode.commands.registerCommand('changeshare.receive', receive),
    vscode.commands.registerCommand('changeshare.undo', undo),
    vscode.commands.registerCommand('changeshare.doctor', () => run('doctor', [], 'ChangeShare: Doctor'))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
