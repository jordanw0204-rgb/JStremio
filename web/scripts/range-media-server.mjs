import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";

const mediaPath = process.argv[2] ? resolve(process.argv[2]) : null;
const port = Number.parseInt(process.argv[3] ?? "8765", 10);
if (!mediaPath || !Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Usage: range-media-server.mjs <media-file> [port]");
}

const size = statSync(mediaPath).size;
const route = `/${encodeURIComponent(basename(mediaPath))}`;
const server = createServer((request, response) => {
  if ((request.method !== "GET" && request.method !== "HEAD") || request.url !== route) {
    response.writeHead(404).end();
    return;
  }

  const range = parseRange(request.headers.range, size);
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const contentLength = end - start + 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": contentLength,
    "Content-Type": "video/mp4",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(mediaPath, { start, end }).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}${route}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function parseRange(value, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value ?? "");
  if (!match) return null;
  const requestedStart = match[1] ? Number.parseInt(match[1], 10) : null;
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : null;
  const start = requestedStart ?? Math.max(0, fileSize - (requestedEnd ?? 0));
  const end = Math.min(requestedEnd ?? fileSize - 1, fileSize - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= fileSize) {
    return null;
  }
  return { start, end };
}
