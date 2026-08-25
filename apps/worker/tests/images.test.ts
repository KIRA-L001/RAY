import assert from "node:assert/strict";
import { test } from "node:test";
import { extractProduct } from "../src/crawler/extract.ts";

test("images come from json-ld, og:image and img tags with filtering", () => {
  const html = `<html><head>
    <meta property="og:image" content="/og.jpg">
    </head><body><h1>Tee</h1><span itemprop="price">299</span>
    <script type="application/ld+json">{"@type":"Product","name":"Tee","image":["https://x.com/a.jpg","data:text/html,bad"]}</script>
    <img src="https://x.com/icon.svg" width="16"><img src="/main.png" alt="front"><img src="//cdn.example.com/b.jpg">
    </body></html>`;
  const p = extractProduct(html, "http://x.com/p/tee");
  const urls = p.images.map((i) => i.url);
  assert.deepEqual(urls, [
    "https://x.com/a.jpg",
    "http://x.com/og.jpg",
    "http://x.com/main.png",
    "http://cdn.example.com/b.jpg",
  ]);
  assert.equal(p.images[2].alt, "front");
});
