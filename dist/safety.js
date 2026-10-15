import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
export const DEFAULT_DENYLIST = ['.env*', '*.pem', '*.key', 'id_rsa*'];
const RULES = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
    ['generic secret assignment', /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^\s"']{4,}/i],
    ['high-entropy credential', /\b[A-Za-z0-9/+_=-]{40,}\b/]
];
export async function loadDenylist(root) {
    try {
        const config = JSON.parse(await readFile(join(root, '.changeshare.json'), 'utf8'));
        if (!Array.isArray(config.denylist) || config.denylist.some((p) => typeof p !== 'string' || !p || p.includes('\0')))
            throw new Error('denylist must be an array of non-empty glob strings');
        return config.denylist;
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return DEFAULT_DENYLIST;
        throw new Error(`Invalid .changeshare.json: ${e.message}`);
    }
}
function matches(pattern, path) {
    const name = basename(path);
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return regex.test(name) || pattern.includes('/') && new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i').test(path);
}
export function denied(files, patterns = DEFAULT_DENYLIST) { return files.filter(f => patterns.some(p => matches(p, f))); }
export function secrets(patch) {
    const text = patch.toString('utf8');
    const findings = [];
    const paths = new Set();
    for (const m of text.matchAll(/^(?:\+\+\+ b\/)([^\t\n]+)/gm))
        paths.add(m[1]);
    for (const path of paths)
        if (basename(path).startsWith('.env'))
            findings.push(`${path}: env-style file`);
    for (const [label, rule] of RULES)
        for (const line of text.split('\n'))
            if (line.startsWith('+') && !line.startsWith('+++') && rule.test(line)) {
                findings.push(`${label} pattern (value hidden)`);
                break;
            }
    return [...new Set(findings)];
}
export function shareCode() {
    const colors = ['amber', 'blue', 'calm', 'coral', 'green', 'indigo', 'jade', 'silver', 'violet', 'yellow'];
    const animals = ['badger', 'falcon', 'gecko', 'heron', 'lynx', 'otter', 'panda', 'tiger', 'yak', 'zebra'];
    const b = randomBytes(3);
    return `${colors[b[0] % colors.length]}-${animals[b[1] % animals.length]}-${10 + b[2] % 90}`;
}
