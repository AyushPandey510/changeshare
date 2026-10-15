import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { randomBytes, scryptSync, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { once } from 'node:events';
import { Bonjour } from 'bonjour-service';
import { cpace } from '@cipherman/pake-js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isIPv4 } from 'node:net';
import { userInfo } from 'node:os';
import type { ChangeSet } from './git.js';

const SERVICE = 'changeshare';
const CI = Buffer.from('changeshare LAN transfer v1');
const MAX = 150 * 1024 * 1024;
type Box = { n: string; c: string; t: string };
function enc(key: Uint8Array, sid: Uint8Array, value: unknown): Box {
  const k = Buffer.from(hkdfSync('sha256', key, sid, Buffer.from('changeshare payload v1'), 32));
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', k, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { n: nonce.toString('base64'), c: body.toString('base64'), t: cipher.getAuthTag().toString('base64') };
}
function dec<T>(key: Uint8Array, sid: Uint8Array, box: Box): T {
  const k = Buffer.from(hkdfSync('sha256', key, sid, Buffer.from('changeshare payload v1'), 32));
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(box.n, 'base64'));
  d.setAuthTag(Buffer.from(box.t, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.c, 'base64')), d.final()]).toString()) as T;
}
function key(code: string, salt: Buffer) { return scryptSync(code, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
function lanIp() {
  const all = Object.values(networkInterfaces()).flat().filter((v): v is NonNullable<typeof v> => !!v && v.family === 'IPv4' && !v.internal);
  const item = all.find(v => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(v.address));
  return item?.address;
}
function localAddress(ip: string) {
  if (!isIPv4(ip)) return false;
  const n = ip.split('.').map(Number);
  return n[0] === 10 || n[0] === 192 && n[1] === 168 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 || n[0] === 169 && n[1] === 254;
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of req) { const b = Buffer.from(part); size += b.length; if (size > MAX) throw new Error('Request exceeds the 150 MB limit.'); chunks.push(b); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function reply(res: ServerResponse, status: number, data: unknown) {
  const bytes = Buffer.from(JSON.stringify(data)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store', 'connection': 'close' }); res.end(bytes);
}
async function prompt(text: string, defaultNo = true) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { const a = (await rl.question(text)).trim().toLowerCase(); return a ? a === 'y' || a === 'yes' : !defaultNo; } finally { rl.close(); }
}
export interface ServeOptions { code: string; port: number; expiresMinutes: number; change: ChangeSet; }
export async function serveShare(opts: ServeOptions) {
  const ip = lanIp(); if (!ip) throw new Error('No LAN interface found. Connect to the local network and run changeshare doctor.');
  const startAt = Date.now(); const expiresAt = startAt + opts.expiresMinutes * 60_000;
  const sid = randomBytes(16); const salt = randomBytes(16); const codeKey = key(opts.code, salt);
  let failures = 0, used = false, pending = false, active: { isk: Uint8Array; session: any } | undefined;
  let resolveDone!: () => void; const done = new Promise<void>(r => resolveDone = r);
  const server = createServer(async (req, res) => {
    try {
      if (Date.now() > expiresAt || used) return reply(res, 410, { error: 'expired' });
      if (req.method === 'GET' && req.url === '/hello') return reply(res, 200, { sid: sid.toString('base64'), salt: salt.toString('base64'), version: 1 });
      if (req.method === 'POST' && req.url === '/connect') {
        if (failures >= 3) return reply(res, 429, { error: 'too many attempts' });
        if (pending || active) return reply(res, 409, { error: 'another receiver is connecting' });
        pending = true;
        try {
          const data = await body(req); const peerIp = req.socket.remoteAddress || 'unknown';
          const receiver = String(data.receiver || 'A receiver').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
          console.log(`\n${receiver} (${peerIp}) wants to receive.`);
          if (!await prompt('Allow? [y/N] ', true)) return reply(res, 403, { error: 'sender rejected' });
          const session = cpace.ristretto255.init({ PRS: codeKey, sid, CI });
          active = { session, isk: new Uint8Array() };
          return reply(res, 200, { share: Buffer.from(session.share).toString('base64') });
        } finally { pending = false; }
      }
      if (req.method === 'POST' && req.url === '/deliver') {
        if (!active) return reply(res, 409, { error: 'no approved connection' });
        const data = await body(req);
        try {
          active.isk = cpace.ristretto255.deriveIskSymmetric({ ephemeralSecret: active.session.ephemeralSecret, ownShare: active.session.share, peerShare: Buffer.from(data.share, 'base64'), sid, ownAD: Buffer.alloc(0), peerAD: Buffer.alloc(0) });
          const check = dec<{ ready: string }>(active.isk, sid, data.box);
          if (check.ready !== 'changeshare-v1') throw new Error('Invalid code.');
        } catch { failures++; active = undefined; if (failures >= 3) resolveDone(); return reply(res, failures >= 3 ? 429 : 401, { error: 'code not recognised or expired' }); }
        const payload = { version: '0.1.0', baseCommit: opts.change.baseCommit, files: opts.change.files, statuses: opts.change.statuses, added: opts.change.added, removed: opts.change.removed, patch: gzipSync(opts.change.patch).toString('base64') };
        used = true;
        const result = enc(active.isk, sid, { payload, sender: { hostname: hostname(), username: userInfo().username } });
        console.log('Delivered. Done.'); resolveDone();
        return reply(res, 200, { box: result });
      }
      reply(res, 404, { error: 'not found' });
    } catch (e: any) { reply(res, 400, { error: e.message || 'invalid request' }); }
  });
  server.requestTimeout = 120_000; server.headersTimeout = 15_000;
  let port = opts.port;
  while (true) {
    server.listen(port, ip);
    try { await once(server, 'listening'); break; }
    catch (e: any) { if (e.code !== 'EADDRINUSE' || port >= 65535) throw e; port++; }
  }
  const bonjour = new Bonjour();
  const service = bonjour.publish({ name: `changeshare-${randomBytes(3).toString('hex')}`, type: SERVICE, port, host: hostname(), txt: { v: '1' } });
  const timer = setTimeout(() => resolveDone(), Math.max(1, expiresAt - Date.now())); timer.unref();
  console.log(`Share code: ${opts.code}`); console.log(`Waiting for receiver at ${ip}:${port} (expires in ${opts.expiresMinutes} min)...`);
  try { await done; } finally { clearTimeout(timer); service.stop(); bonjour.destroy(); server.close(); codeKey.fill(0); }
}
export async function discover(port: number, host?: string) {
  if (host) {
    if (!localAddress(host)) throw new Error('--host must be a private LAN or link-local IP address.');
    return `http://${host}:${port}`;
  }
  const bonjour = new Bonjour(); const browser = bonjour.find({ type: SERVICE });
  try {
    const found = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not find the sender automatically. Ask them for their IP, then pass --host <ip>.')), 10_000);
      browser.on('up', (svc: any) => { const ip = svc.addresses?.find((a: string) => a.includes('.') && localAddress(a)); if (ip) { clearTimeout(timer); resolve(`http://${ip}:${svc.port}`); } });
    });
    return found;
  } finally { browser.stop(); bonjour.destroy(); }
}
async function fetchJson<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const res = await fetch(url, { method, redirect: 'error', headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(180_000) });
  const json: any = await res.json(); if (!res.ok) throw new Error(json.error || `Connection failed (${res.status}).`); return json as T;
}
export async function pullShare(code: string, host?: string, port = 8765) {
  const url = await discover(port, host);
  const hello = await fetchJson<{ sid: string; salt: string }>(`${url}/hello`);
  const sid = Buffer.from(hello.sid, 'base64'); const codeKey = key(code, Buffer.from(hello.salt, 'base64'));
  const client = cpace.ristretto255.init({ PRS: codeKey, sid, CI });
  const connection = await fetchJson<{ share: string }>(`${url}/connect`, 'POST', { receiver: hostname() });
  const isk = cpace.ristretto255.deriveIskSymmetric({ ephemeralSecret: client.ephemeralSecret, ownShare: client.share, peerShare: Buffer.from(connection.share, 'base64'), sid, ownAD: Buffer.alloc(0), peerAD: Buffer.alloc(0) });
  const response = await fetchJson<{ box: Box }>(`${url}/deliver`, 'POST', { share: Buffer.from(client.share).toString('base64'), box: enc(isk, sid, { ready: 'changeshare-v1' }) });
  const envelope = dec<{ payload: { version: string; baseCommit: string; files: string[]; statuses: Record<string, string>; added: number; removed: number; patch: string }; sender: { hostname: string; username: string } }>(isk, sid, response.box);
  const payload = envelope.payload;
  codeKey.fill(0);
  return { ...payload, sender: envelope.sender, patch: gunzipSync(Buffer.from(payload.patch, 'base64')) };
}
