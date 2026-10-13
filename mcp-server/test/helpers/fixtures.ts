import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const links = ["Home", "Products", "Solutions", "Pricing", "Docs", "Blog", "Careers", "Contact"].map((t) => `<a href="#${t}">${t}</a>`).join("");

export const BROKEN = `<!doctype html><html><head><meta charset="utf-8"><title>Broken page</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font:16px/1.4 sans-serif}
  .nav{display:flex;white-space:nowrap;background:#eee}
  .nav a{padding:12px 24px;color:#123}
  .banner{width:640px;height:60px;background:#bcd}
  .scroller{overflow-x:auto;width:300px;border:1px solid #999}
  .scroller .inner{width:900px;height:30px;background:#dcb}
  .tiny{font-size:9px}
  .small-btn{display:block;width:16px;height:16px;padding:0}
</style></head><body>
<nav class="nav" id="main-nav">${links}</nav>
<div class="banner" id="promo-banner">Promo banner</div>
<div class="scroller" id="carousel"><div class="inner">contained scroll content</div></div>
<p class="tiny">Fine print</p>
<button class="small-btn" id="tiny-btn" aria-label="close"></button>
<script>console.error("fixture console error"); fetch("/missing.json").catch(()=>{}); </script>
</body></html>`;

export const FIXED = BROKEN
  .replace(".nav{display:flex;white-space:nowrap;background:#eee}", ".nav{display:flex;flex-wrap:wrap;background:#eee}")
  .replace(".banner{width:640px;", ".banner{width:640px;max-width:100%;")
  .replace("<script>console.error(\"fixture console error\"); fetch(\"/missing.json\").catch(()=>{}); </script>", "");

export interface Fixture {
  url: string;
  setHtml: (html: string) => void;
  close: () => Promise<void>;
}

export function serve(initial = BROKEN): Promise<Fixture> {
  let html = initial;
  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith("/missing.json")) {
      res.writeHead(404).end("nope");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
        setHtml: (h) => {
          html = h;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      }),
    ),
  );
}
