// Screenshots the built site (public/ or $PUBLIC_DIR) at several widths.
// Usage: node scripts/shoot.mjs <output-dir>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.resolve(root, process.env.PUBLIC_DIR || "public");
const outDir = path.resolve(process.argv[2] || "shots");

const WIDTHS = [375, 768, 1280, 1920];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname.split("/").includes("..") || pathname.includes("\0")) {
        res.writeHead(400).end("Bad request");
        return;
      }
      let file = path.join(publicDir, pathname);
      if (file !== publicDir && !file.startsWith(publicDir + path.sep)) {
        res.writeHead(400).end("Bad request");
        return;
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500).end("Server error");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(path.join(publicDir, "index.html"))) {
    throw new Error(`${publicDir}/index.html not found: run hugo first (npm run build)`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let server;
  let browser;
  try {
    server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch();
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(base, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) console.warn(`warning: horizontal overflow of ${overflow}px at ${width}px`);
      const viewportFile = path.join(outDir, `viewport-${width}.png`);
      await page.screenshot({ path: viewportFile });
      console.log(viewportFile);
      if (width === 1280) {
        const fullFile = path.join(outDir, "full-1280.png");
        await page.screenshot({ path: fullFile, fullPage: true });
        console.log(fullFile);
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
