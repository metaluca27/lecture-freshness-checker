// 화면(web 폴더)을 로컬에서 여는 작은 서버. 따로 설치할 것이 없다.
//   npm run web   →  http://localhost:8799
// 워커가 이 주소(http://localhost:8799)에서 온 요청만 받으므로 포트를 바꾸지 않는다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORT = 8799;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('찾을 수 없어요');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`화면: http://localhost:${PORT}`);
});
