// Generates a self-signed TLS certificate for local + LAN HTTPS so the
// in-app QR scanner (which needs a secure context) works on phones.
// Adds every non-internal IPv4 address as a SAN, plus localhost.
// Uses the system `openssl` binary. Output: certs/key.pem + certs/cert.pem.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(certDir, { recursive: true });

const ips = [];
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
}

const sans = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)];

const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

// Prefer openssl on PATH, fall back to the copy shipped with Git for Windows.
function resolveOpenssl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('openssl not found. Install OpenSSL or Git for Windows.');
}

execFileSync(
  resolveOpenssl(),
  [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '3650',
    '-subj', '/CN=localhost',
    '-addext', `subjectAltName=${sans.join(',')}`,
  ],
  { stdio: 'inherit' }
);

console.log('\nWrote certs/key.pem and certs/cert.pem');
console.log('Valid for: localhost, 127.0.0.1' + (ips.length ? ', ' + ips.join(', ') : ''));
