#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:net';
import { applyPatch, git, localChanges, makeUndo, repoRoot, stashChanges, undo, workingChanges } from './git.js';
import { denied, loadDenylist, secrets, shareCode } from './safety.js';
import { pullShare, serveShare } from './transfer.js';

const exec = promisify(execFile);
const VERSION = '0.1.0';
function help() { console.log(`changeshare ${VERSION}\n\nUsage:\n  changeshare send [paths...] [--stash [ref]] [--yes] [--preview] [--port n] [--expires min] [--include-ignored]\n  changeshare receive <code> [--host ip] [--port n] [--yes] [--3way] [--dry-run]\n  changeshare undo\n  changeshare doctor [--listen | --peer ip]\n`); }
async function confirm(question: string, yes = false, defaultNo = false) {
  if (yes) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  try { const answer = (await rl.question(`${question} `)).trim().toLowerCase(); return answer ? answer === 'y' || answer === 'yes' : !defaultNo; } finally { rl.close(); }
}
function option(args: string[], name: string, fallback?: string) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; }
function ips() { return Object.values(networkInterfaces()).flat().filter(v => v && v.family === 'IPv4' && !v.internal).map(v => v!.address); }
async function portFree(port: number) { return new Promise<boolean>(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); }); }
function privateIp(ip: string) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip); }
async function send(args: string[]) {
  const root = await repoRoot(); const yes = args.includes('--yes');
  const portArg = Number(option(args, '--port', '8765')); const expires = Number(option(args, '--expires', '10'));
  if (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535 || !Number.isInteger(expires) || expires <= 0 || expires > 1440) throw new Error('Port must be 1–65535 and expiry must be 1–1440 minutes.');
  const stash = args.includes('--stash');
  const stashIndex = args.indexOf('--stash'); const stashRef = stash && args[stashIndex + 1] && !args[stashIndex + 1].startsWith('--') ? args[stashIndex + 1] : undefined;
  const paths = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] === '--port' || args[i - 1] === '--expires') && !(stash && i === stashIndex + 1 && stashRef));
  const denylist = await loadDenylist(root);
  let change = stash ? await stashChanges(root, stashRef) : await workingChanges(root, paths, args.includes('--include-ignored'), denylist);
  if (!change.patch.length) { console.log('No changes to share'); return; }
  const blocked = args.includes('--include-ignored') ? [] : denied(change.files, denylist);
  if (blocked.length) throw new Error(`Denylist paths are present in the patch: ${blocked.join(', ')}. Remove them or review your .changeshare.json.`);
  if (!change.files.length || !change.patch.length) { console.log('No changes to share'); return; }
  const found = secrets(change.patch);
  console.log(`${change.files.length} file(s), +${change.added} -${change.removed}, ${(change.patch.length / 1024).toFixed(1)} KB`);
  console.log(change.files.map(f => `  ${f}`).join('\n'));
  if (args.includes('--preview')) console.log(`\n${change.patch.toString('utf8')}`);
  if (change.patch.length > 100 * 1024 * 1024) console.log('Warning: this patch is over 100 MB.');
  if (found.length) {
    console.log('Potential secrets found:'); found.forEach(f => console.log(`  ${f}`));
    if (!await confirm('Review the patch and confirm these findings are safe to share? [y/N]', false, true)) return;
  } else console.log('No secrets found.');
  if (!await confirm('Send? [Y/n]', yes)) return;
  const code = shareCode();
  await serveShare({ code, port: portArg, expiresMinutes: expires, change });
}
async function receive(args: string[]) {
  const root = await repoRoot(); const code = args.find(a => !a.startsWith('--'));
  if (!code) throw new Error('Usage: changeshare receive <code>');
  const host = option(args, '--host'); const port = Number(option(args, '--port', '8765'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  const dirty = await localChanges(root);
  if (dirty && !await confirm('Your working tree has local changes. Stash tracked and untracked changes before receiving? [y/N]', false, true)) throw new Error('Working tree is unchanged. Stash or commit your local changes and retry.');
  const payload = await pullShare(code, host, port);
  const patch = payload.patch;
  const base = (await git(['rev-parse', 'HEAD'], root)).toString().trim();
  const baseDiffers = base !== payload.baseCommit;
  console.log(`${payload.sender.username}@${payload.sender.hostname} is sharing changes. ${payload.files.length} file(s), ${(patch.length / 1024).toFixed(1)} KB${baseDiffers ? '\nWarning: base commit differs from the sender.' : ''}`);
  payload.files.forEach(f => console.log(`  ${payload.statuses[f] || 'changed'} ${f}`));
  if (args.includes('--dry-run')) {
    try { await applyPatch(root, patch, args.includes('--3way'), true); console.log('Dry run: patch applies cleanly.'); }
    catch (e: any) { console.log(`Dry run found conflicts: ${e.message}`); }
    return;
  }
  if (!await confirm('Apply these changes? [Y/n]', args.includes('--yes'))) return;
  let use3way = args.includes('--3way') || baseDiffers;
  let reject = false;
  if (!use3way) {
    try { await applyPatch(root, patch, false, true); }
    catch (e: any) {
      console.log(`Patch does not apply cleanly: ${e.message}`);
      const mode = await chooseConflict();
      if (mode === 'abort') return;
      use3way = mode === '3way'; reject = mode === 'reject';
    }
  } else if (baseDiffers && !args.includes('--3way')) {
    if (!await confirm('Try a three-way apply? [Y/n]', args.includes('--yes'))) return;
  }
  if (dirty) await git(['stash', 'push', '--include-untracked', '-m', `changeshare-autostash-${Date.now()}`], root);
  try { await applyPatch(root, patch, use3way, false, false, reject); }
  catch (e: any) { throw new Error(`Could not apply the transfer; no changes were applied. ${e.message}`); }
  const undoPaths = reject ? [...payload.files, ...payload.files.map(f => `${f}.rej`)] : payload.files;
  const applied = await workingChanges(root, undoPaths, true);
  await makeUndo(root, applied.patch);
  console.log(`Applied as uncommitted changes. Run \`changeshare undo\` to revert.${reject ? ' Rejected hunks are in .rej files.' : ''}${dirty ? ' Your previous work is saved in the Git stash; use git stash pop after reviewing or undoing.' : ''}`);
}
async function chooseConflict(): Promise<'3way' | 'reject' | 'abort'> {
  const rl = createInterface({ input: stdin, output: stdout });
  try { const a = (await rl.question('Choose: [3] three-way, [r] apply clean hunks and write .rej files, [a] abort: ')).trim().toLowerCase(); return a === '3' || a === '3way' ? '3way' : a === 'r' ? 'reject' : 'abort'; } finally { rl.close(); }
}
async function doctor() {
  const args = process.argv.slice(3); const listen = args.includes('--listen'); const peer = option(args, '--peer');
  const check = async (label: string, fn: () => Promise<string>, test?: (v: string) => boolean) => { try { const v = await fn(); const ok = test ? test(v) : true; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${v}`); } catch (e: any) { console.log(`FAIL ${label}: ${e.message}`); } };
  await check('Git (2.30+)', async () => (await git(['--version'])).toString().trim(), v => { const m = v.match(/(\d+)\.(\d+)/); return !!m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 30)); });
  await check('Node.js (22+)', async () => process.version, () => Number(process.versions.node.split('.')[0]) >= 22);
  await check('Git repository', async () => await repoRoot());
  const port = await portFree(8765); console.log(`${port ? 'PASS' : 'WARN'} default port 8765: ${port ? 'available' : 'in use'}`);
  const lan = ips().filter(privateIp); console.log(`INFO LAN IP: ${lan.join(', ') || 'not detected'}`);
  try { await exec('systemctl', ['is-active', '--quiet', 'avahi-daemon']); console.log('PASS avahi-daemon: running'); } catch { console.log('WARN avahi-daemon: unavailable; use --host'); }
  let firewallKnown = false;
  try { const { stdout: result } = await exec('ufw', ['status']); firewallKnown = true; if (/Status:\s+inactive/i.test(result)) console.log('PASS ufw: inactive'); else { const allowed = /8765\/tcp\s+ALLOW/i.test(result); console.log(`${allowed ? 'PASS' : 'WARN'} ufw: ${allowed ? 'port 8765/tcp allowed' : 'port 8765/tcp is not explicitly allowed (run sudo ufw allow 8765/tcp)'}`); } } catch {}
  if (!firewallKnown) { try { const { stdout: result } = await exec('firewall-cmd', ['--query-port=8765/tcp']); firewallKnown = true; const allowed = result.trim() === 'yes'; console.log(`${allowed ? 'PASS' : 'WARN'} firewalld: ${allowed ? 'port 8765/tcp allowed' : 'port 8765/tcp is blocked (run sudo firewall-cmd --add-port=8765/tcp --permanent)'}`); } catch {} }
  if (!firewallKnown) console.log('INFO Firewall: ufw/firewalld not detected; check local firewall rules if peers cannot connect.');
  if (peer) {
    if (!privateIp(peer)) console.log('FAIL peer IP: provide a private or link-local LAN IPv4 address.');
    else await new Promise<void>(resolve => { const socket = connect(8766, peer); socket.setTimeout(3000); socket.once('connect', () => { console.log(`PASS peer connection to ${peer}:8766`); socket.end(); resolve(); }); socket.once('error', e => { console.log(`FAIL peer connection: ${e.message}; device-to-device traffic may be blocked by the network.`); resolve(); }); socket.once('timeout', () => { console.log('FAIL peer connection timed out; device-to-device traffic may be blocked by the network.'); socket.destroy(); resolve(); }); });
  }
  if (listen) {
    const ip = lan[0]; if (!ip) throw new Error('No LAN IP available for peer test.');
    const server = createServer(s => s.end('changeshare doctor peer test\n'));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(8766, ip, resolve); });
    console.log(`Listening for a peer test at ${ip}:8766. Press Ctrl-C to stop.`);
    await new Promise<void>(resolve => process.once('SIGINT', () => { server.close(); resolve(); }));
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (!command || command === '--help' || command === '-h') return help();
    if (command === '--version' || command === '-v') return console.log(VERSION);
    if (command === 'send') return await send(args);
    if (command === 'receive') return await receive(args);
    if (command === 'undo') { const root = await repoRoot(); await undo(root); return console.log('Reverted the most recent changeshare transfer.'); }
    if (command === 'doctor') return await doctor();
    help(); process.exitCode = 2;
  } catch (e: any) { console.error(`Error: ${e.message}\nNext step: run changeshare doctor or check the command options.`); process.exitCode = 1; }
}
void main();
