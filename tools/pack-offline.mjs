// Packs dist/ into halcyon-offline.zip for exhibition day (no internet needed).
// The ZIP contains the game, a dependency-free static server (Node) and
// launcher scripts for Windows/macOS/Linux (falling back to Python).
//   npm run build && npm run pack:offline
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const DIST = "dist";
const OUT = "halcyon-offline.zip";
const ROOT = "halcyon-offline";

const SERVE = `// Minimal static server for the offline build. Usage: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(fileURLToPath(new URL('.', import.meta.url)), 'game');
const port = Number(process.argv[2] ?? 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.bin': 'application/octet-stream' };
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', () => console.log('HALCYON LINE: http://localhost:' + port + '/'));
`;

const START_BAT = `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:8080/"
  node serve.mjs 8080
) else (
  echo Node.js not found, using Python...
  start "" "http://localhost:8080/"
  cd game
  python -m http.server 8080 --bind 127.0.0.1
)
`;

const START_SH = `#!/bin/sh
cd "$(dirname "$0")"
URL=http://localhost:8080/
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) &
if command -v node >/dev/null 2>&1; then node serve.mjs 8080; else cd game && python3 -m http.server 8080 --bind 127.0.0.1; fi
`;

const README = `HALCYON LINE — offline build
=============================
1. Unzip anywhere.
2. Windows: double-click start.bat / macOS・Linux: sh start.sh
3. The browser opens http://localhost:8080/ (Chrome / Edge). Press F11 for full screen.

Requires Node.js 18+ or Python 3. No internet connection needed.
Troubleshooting: add ?engine=webgl to the URL if WebGPU misbehaves, ?q=low for weak GPUs.
`;

// --- tiny ZIP writer (deflate, CRC32) ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = [
  ...walk(DIST).map((f) => ({
    name: `${ROOT}/game/${relative(DIST, f).split("\\").join("/")}`,
    data: readFileSync(f),
  })),
  { name: `${ROOT}/serve.mjs`, data: Buffer.from(SERVE) },
  {
    name: `${ROOT}/start.bat`,
    data: Buffer.from(START_BAT.replace(/\n/g, "\r\n")),
  },
  { name: `${ROOT}/start.sh`, data: Buffer.from(START_SH), mode: 0o755 },
  { name: `${ROOT}/README.txt`, data: Buffer.from(README) },
];

const parts = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name);
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, comp);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE((3 << 8) | 20, 4); // made by unix
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(e.data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE((((e.mode ?? 0o644) | 0o100000) << 16) >>> 0, 38);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, name);
  offset += local.length + name.length + comp.length;
}
const cdSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(OUT, Buffer.concat([...parts, ...central, end]));
console.log(
  `wrote ${OUT}: ${entries.length} files, ${(statSync(OUT).size / 1048576).toFixed(2)} MiB`,
);
