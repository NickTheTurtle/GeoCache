// Custom production launcher for the SvelteKit (adapter-node) build.
//
// adapter-node emits ./build/handler.js exporting `handler`, a plain Node
// request listener. We wrap it so we can:
//   - serve HTTPS on 443 (+ PORT) when certs/ exists, so phones can use the
//     camera (a secure context is required for getUserMedia), and
//   - redirect plain HTTP on 80 -> HTTPS.
// Run `npm run build` first, then `npm start`.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { handler } from './build/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);

const keyPath = path.join(__dirname, 'certs', 'key.pem');
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const httpsEnabled = fs.existsSync(keyPath) && fs.existsSync(certPath);

if (httpsEnabled) {
  const creds = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

  // Standard HTTPS port (443) so a bare LAN IP works on phones, plus PORT for dev.
  const httpsPorts = [...new Set([HTTPS_PORT, PORT])];
  for (const p of httpsPorts) {
    https
      .createServer(creds, handler)
      .listen(p, () => console.log(`GeoCache SF running on https://localhost:${p}`))
      .on('error', (err) => console.log(`HTTPS not started on port ${p}: ${err.message}`));
  }

  // Plain HTTP on 80 -> 301 to HTTPS (default 443, so no port in the URL).
  http
    .createServer((req, res) => {
      const host = (req.headers.host || 'localhost').split(':')[0];
      const suffix = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
      res.writeHead(301, { Location: `https://${host}${suffix}${req.url}` });
      res.end();
    })
    .listen(HTTP_PORT, () => console.log(`HTTP redirect running on port ${HTTP_PORT} -> HTTPS`))
    .on('error', (err) => console.log(`HTTP redirect not started on port ${HTTP_PORT}: ${err.message}`));
} else {
  http
    .createServer(handler)
    .listen(PORT, () => {
      console.log(`GeoCache SF running on http://localhost:${PORT}`);
      console.log('Tip: run `npm run gen-cert` to enable HTTPS (needed for the QR scanner on phones).');
    });
}
