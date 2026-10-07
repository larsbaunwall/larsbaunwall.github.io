import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.resolve(root, process.env.PUBLIC_DIR || "public");

const TARGETS = [
  {
    name: "full",
    url: "/print/full/",
    out: "lars-baunwall-cv.pdf",
    pages: { warnOutside: [2, 4], failAbove: 6 },
    maxKB: 600,
  },
  {
    name: "onepage",
    url: "/print/onepage/",
    out: "lars-baunwall-cv-onepage.pdf",
    exact: 1,
    maxKB: 400,
    fit: true,
  },
];

const FIT_SCALES = [1, 0.97, 0.94, 0.91];
const PDF_SCALES = [0.96, 0.92, 0.88];
const OVERFLOW_MSG =
  "One-pager overflows; reduce cv.overrides.json onepage.skills/maxRoles/maxHighlights";

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

/** Number of pages: the largest /Count found on a /Type /Pages dictionary. */
export function countPages(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf);
  let max = 0;
  for (const m of text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/gs)) max = Math.max(max, Number(m[1]));
  // Skia writes /Count before /Type; match whole simple dictionaries too.
  for (const m of text.matchAll(/<<[^<>]*\/Type\s*\/Pages\b[^<>]*>>/gs)) {
    const c = m[0].match(/\/Count\s+(\d+)/);
    if (c) max = Math.max(max, Number(c[1]));
  }
  return max;
}

/** Throws on a bad font set; returns the list of embedded font names. */
export function assertFonts(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf);
  const names = [...new Set([...text.matchAll(/\/FontName\s*\/([^\s/<>[\]()]+)/g)].map((m) => m[1]))];
  if (!names.length) throw new Error("No fonts found in PDF");
  const bad = names.filter((n) => !/^[A-Z]{6}\+/.test(n));
  if (bad.length) throw new Error(`Non-subset fonts in PDF: ${bad.join(", ")}`);
  const fallback = names.filter((n) => /Times|Helvet|Arial|DejaVu|Liberation/i.test(n));
  if (fallback.length) throw new Error(`Fallback fonts in PDF: ${fallback.join(", ")}`);
  for (const need of ["+SourceSerif4", "+Inter"]) {
    if (!names.some((n) => n.includes(need))) throw new Error(`PDF is missing embedded font ${need.slice(1)} (found: ${names.join(", ")})`);
  }
  return names;
}

async function pdfBuffer(page, pdfScale) {
  const opts = {
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    tagged: true,
    outline: true,
  };
  if (pdfScale && pdfScale !== 1) opts.scale = pdfScale;
  return Buffer.from(await page.pdf(opts));
}

async function renderTarget(browser, base, target, external) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith(base + "/") || u === base) return;
      if (u.startsWith("data:") || u.startsWith("about:") || u.startsWith("blob:")) return;
      external.push(`${target.url}: ${u}`);
    });
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    const resp = await page.goto(base + target.url, { waitUntil: "networkidle" });
    if (!resp || !resp.ok()) throw new Error(`${target.url}: HTTP ${resp ? resp.status() : "no response"}`);
    await page.evaluate(() => document.fonts.ready);
    for (const family of ["Source Serif 4", "Inter"]) {
      const ok = await page.evaluate((f) => document.fonts.check(`12px "${f}"`), family);
      if (!ok) throw new Error(`${target.url}: font "${family}" did not load; refusing to render PDF with fallback font`);
    }

    let buffer;
    let pages;
    let scale = 1;
    if (target.fit) {
      let fitted = false;
      for (const s of FIT_SCALES) {
        await page.evaluate((v) => document.documentElement.style.setProperty("--op-scale", String(v)), s);
        buffer = await pdfBuffer(page);
        pages = countPages(buffer);
        scale = s;
        if (pages === 1) {
          fitted = true;
          break;
        }
      }
      if (!fitted) {
        for (const ps of PDF_SCALES) {
          buffer = await pdfBuffer(page, ps);
          pages = countPages(buffer);
          scale = ps;
          if (pages === 1) {
            fitted = true;
            break;
          }
        }
      }
      if (!fitted) throw new Error(OVERFLOW_MSG);
    } else {
      buffer = await pdfBuffer(page);
      pages = countPages(buffer);
    }
    return { buffer, pages, scale };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  if (!fs.existsSync(path.join(publicDir, "index.html"))) {
    throw new Error(`${path.relative(root, publicDir) || publicDir}/index.html not found: run hugo first (npm run build)`);
  }
  let server;
  let browser;
  const failures = [];
  const external = [];
  try {
    server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();

    for (const target of TARGETS) {
      try {
        const { buffer, pages, scale } = await renderTarget(browser, base, target, external);
        const kb = Math.round(buffer.length / 1024);
        if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(`${target.out}: not a PDF`);
        assertFonts(buffer);
        if (pages === 0) throw new Error(`${target.out}: could not determine page count`);
        if (target.exact && pages !== target.exact) throw new Error(`${target.out}: ${pages} pages, expected ${target.exact}`);
        if (target.pages) {
          if (pages > target.pages.failAbove) throw new Error(`${target.out}: ${pages} pages, more than ${target.pages.failAbove}`);
          const [lo, hi] = target.pages.warnOutside;
          if (pages < lo || pages > hi) console.log(`::warning::Full CV is ${pages} page${pages === 1 ? "" : "s"}`);
        }
        if (kb > target.maxKB) throw new Error(`${target.out}: ${kb} KB exceeds ${target.maxKB} KB`);
        fs.writeFileSync(path.join(publicDir, target.out), buffer);
        console.log(`${target.name}: ${pages} page${pages === 1 ? "" : "s"}, ${kb} KB, scale ${scale}`);
      } catch (err) {
        failures.push(err.message || String(err));
      }
    }
    if (external.length) {
      failures.push(`External requests during render:\n  ${[...new Set(external)].join("\n  ")}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }
  if (failures.length) {
    for (const f of failures) console.error(`::error::${f.split("\n")[0]}${f.includes("\n") ? "\n" + f.split("\n").slice(1).join("\n") : ""}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
