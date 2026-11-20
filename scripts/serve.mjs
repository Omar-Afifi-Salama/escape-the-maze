// Zero-dependency static file server for dist/
// Usage: npm run serve  (or: node scripts/serve.mjs [port])
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
);
const PORT = Number(process.argv[2]) || 5000;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".map": "application/json",
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = path.join(
        ROOT,
        path.normalize(decodeURIComponent(url.pathname)),
    );

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
    }

    if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end(
            "404 Not Found",
        );
        return;
    }

    res.writeHead(200, {
        "Content-Type":
            MIME[path.extname(filePath).toLowerCase()] ??
            "application/octet-stream",
        "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
    console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});
