import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProduct } from '../src/crawler/extract.ts';

test('json-ld aggregate offer yields variants', () => {
  const html = '<html><head><script type="application/ld+json">{"@type":"Product","name":"Shoe","offers":{"@type":"AggregateOffer","offers":[{"name":"Size 8","price":"499","priceCurrency":"INR","availability":"https://schema.org/InStock"},{"name":"Size 9","price":"549","priceCurrency":"INR","availability":"https://schema.org/OutOfStock"}]}}</script></head><body><h1>Shoe</h1></body></html>';
  const p = extractProduct(html, 'http://x.com/p/shoe');
  assert.equal(p.variants.length, 2);
  assert.equal(p.variants[0].name, 'Size 8');
  assert.equal(p.variants[0].available, true);
  assert.equal(p.variants[1].available, false);
});

test('select pickers yield variants; default variant otherwise', () => {
  const withSelect = '<html><body><h1>Tee</h1><span itemprop="price">299</span><select name="Color"><option>Select</option><option>Red</option><option>Blue</option></select></body></html>';
  const a = extractProduct(withSelect, 'http://x.com/p/tee');
  assert.deepEqual(a.variants.map((v) => v.name), ['Color: Red', 'Color: Blue']);
  const plain = extractProduct('<html><body><h1>Mug</h1><p>Price: $' + '12.50</p></body></html>', 'http://x.com/p/mug');
  assert.equal(plain.variants.length, 1);
  assert.equal(plain.variants[0].name, 'Default');
});
