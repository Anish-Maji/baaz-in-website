// Tiny local server for this site, with live reload. Run:  node serve.mjs
// Then open http://localhost:5173
//
// Live reload: the server watches this folder. When you save a file,
//  - a .css change is swapped in instantly (no reload, scroll position kept)
//  - anything else (html, js, images, fonts…) reloads the page.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT) || 5173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/* ---------- live reload: browser side ---------- */
const LIVE_CLIENT = `
<script>
(() => {
  let wasDown = false;
  const connect = () => {
    const es = new EventSource('/__live');
    es.onopen = () => { if (wasDown) location.reload(); };   // server restarted
    es.onmessage = (e) => {
      const { type, file } = JSON.parse(e.data);
      if (type === 'css') {
        let swapped = false;
        document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
          const url = new URL(link.href);
          if (url.origin !== location.origin) return;
          if (file && !url.pathname.endsWith(file)) return;
          url.searchParams.set('v', Date.now());
          const fresh = link.cloneNode();
          fresh.href = url.href;
          fresh.onload = () => link.remove();      // swap without a flash of unstyled page
          link.after(fresh);
          swapped = true;
        });
        if (!swapped) location.reload();
        console.log('[live] styles updated: ' + file);
      } else {
        console.log('[live] reloading for: ' + file);
        location.reload();
      }
    };
    es.onerror = () => { wasDown = true; es.close(); setTimeout(connect, 1000); };
  };
  connect();
})();
</script>`;

/* ---------- live reload: server side ---------- */
const clients = new Set();

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

let pending = new Map();
let timer = null;
const IGNORE = /(^|[\\/])(\.git|\.claude|node_modules)([\\/]|$)|~$|\.tmp$|\.swp$/;

watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || IGNORE.test(filename)) return;
  const file = filename.split(sep).join('/');
  if (file === 'serve.mjs') return;               // restart the server yourself for this one
  pending.set(file, extname(file).toLowerCase() === '.css' ? 'css' : 'reload');

  // editors often save in several steps; wait a moment and send one update
  clearTimeout(timer);
  timer = setTimeout(() => {
    // skip editor/tool temp files: they have no extension or are already gone
    const changes = [...pending].filter(([f]) => extname(f) && existsSync(join(root, f)));
    pending = new Map();
    if (!changes.length) return;
    const needsReload = changes.find(([, type]) => type === 'reload');
    if (needsReload) {
      console.log(`[live] ${needsReload[0]} changed, reloading`);
      broadcast({ type: 'reload', file: needsReload[0] });
    } else {
      for (const [file] of changes) {
        console.log(`[live] ${file} changed, swapping styles`);
        broadcast({ type: 'css', file });
      }
    }
  }, 80);
});

/* ---------- static files ---------- */
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/__live') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  try {
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(join(root, normalize(path)));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
    let body = await readFile(file);
    const ext = extname(file).toLowerCase();

    if (ext === '.html') {
      const html = body.toString('utf8');
      body = html.includes('</body>') ? html.replace('</body>', `${LIVE_CLIENT}\n</body>`) : html + LIVE_CLIENT;
    }

    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Cloud site running at http://localhost:${port} (live reload on)`);
});
