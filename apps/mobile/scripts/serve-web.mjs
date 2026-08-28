import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.env.MODREEF_WEB_ROOT ?? "dist");
const port = Number(process.env.PORT ?? 3000);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function assetPath(pathname) {
  try {
    const decoded = decodeURIComponent(pathname);
    const relative = normalize(decoded).replace(/^[/\\]+/, "");
    const candidate = resolve(join(root, relative));
    if (candidate !== root && !candidate.startsWith(`${root}/`)) return null;
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ name: "modreef-web", status: "ready" }));
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }

  const requested = assetPath(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = requested ?? (extname(url.pathname) ? null : assetPath("/index.html"));
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const extension = extname(file).toLowerCase();
  response.writeHead(200, {
    "content-type": mimeTypes.get(extension) ?? "application/octet-stream",
    "cache-control": extension === ".html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, "::", () => {
  console.log(`modREEF Web listening on port ${port}`);
});
