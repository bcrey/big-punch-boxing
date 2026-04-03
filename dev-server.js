require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const fightersHandler = require('./api/fighters');
const fighterByIdHandler = require('./api/fighters/[id]');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Collect body for POST/PUT
  if (req.method === 'POST' || req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    await new Promise(resolve => req.on('end', resolve));
    try { req.body = JSON.parse(body); } catch { req.body = {}; }
  }

  // Add Express-like helpers to response
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };

  // API routes
  if (pathname === '/api/fighters') {
    return fightersHandler(req, res);
  }
  const idMatch = pathname.match(/^\/api\/fighters\/(.+)$/);
  if (idMatch) {
    req.query = { id: decodeURIComponent(idMatch[1]) };
    return fighterByIdHandler(req, res);
  }

  // Static files from public/
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Dev server running at http://localhost:${PORT}`));
