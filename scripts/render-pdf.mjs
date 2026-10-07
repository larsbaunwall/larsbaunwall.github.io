import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const outFile = path.join(publicDir, "lars-baunwall-cv.pdf");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (pathname.split("/").includes("..") || pathname.includes("\0")) {
        res.writeHead(400).end("Bad request");
        return;
      }
      let file = path.join(publicDir, pathname);
      if (!file.startsWith(publicDir)) {
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
    throw new Error("public/index.html not found: run hugo first (npm run build)");
  }
  let server;
  let browser;
  try {
    server = await startServer();
    const { port } = server.address();
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const fontOk = await page.evaluate(() => document.fonts.check('12px "Source Serif 4"'));
    if (!fontOk) throw new Error('Font "Source Serif 4" did not load; refusing to render PDF with fallback font');

    const name =
      ((await page.locator("h1.name").first().textContent({ timeout: 5000 })) || "").trim() || "Curriculum Vitae";

    await page.pdf({
      path: outFile,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#A8A49C;padding:0 18mm;display:flex;justify-content:space-between;"><span>${escapeHtml(name)} · Curriculum Vitae</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    const kb = Math.round(fs.statSync(outFile).size / 1024);
    console.log(`PDF written: public/lars-baunwall-cv.pdf (${kb} KB)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
