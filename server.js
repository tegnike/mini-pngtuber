const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function safeJoin(base, target) {
  const targetPath = path.posix.normalize('/' + target).replace(/^\/+/, '');
  return path.join(base, targetPath);
}

function listImages() {
  try {
    const items = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true });
    const images = items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name))
      .sort((a, b) => a.localeCompare(b));
    return images;
  } catch (e) {
    return [];
  }
}

const server = http.createServer((req, res) => {
  // Basic routing
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/images') {
    const data = listImages();
    res.writeHead(200, { 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ images: data }));
    return;
  }

  // Default: serve static files from public
  let filePath = url.pathname;
  try {
    filePath = decodeURIComponent(filePath);
  } catch (_) {
    // ignore malformed encodings
  }
  if (filePath === '/' || filePath === '') {
    filePath = '/index.html';
  }

  // Prevent path traversal
  const resolved = safeJoin(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';

    // Basic caching for static assets (except HTML and JSON)
    const isImmutable = !['.html', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': isImmutable ? 'public, max-age=86400' : 'no-cache',
    });

    fs.createReadStream(resolved).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`PNGTuber server running at http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nエラー: ポート ${PORT} は既に使用されています。`);
    console.error(`以下のコマンドでポート ${PORT} を使用しているプロセスを確認できます:`);
    console.error(`  lsof -ti:${PORT}`);
    console.error(`\nプロセスを終了するには:`);
    console.error(`  kill -9 $(lsof -ti:${PORT})`);
    console.error(`\nまたは、別のポートを使用するには:`);
    console.error(`  PORT=3001 node server.js\n`);
  } else {
    console.error('サーバーの起動中にエラーが発生しました:', err);
  }
  process.exit(1);
});
