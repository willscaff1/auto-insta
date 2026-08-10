import assert from "node:assert/strict";
import test from "node:test";
import { extractOfferFromHtml, validatePromotion } from "../promotions.mjs";

const html = `
  <html><head><script type="application/ld+json">
    {"@type":"Product","offers":{"@type":"Offer","price":"199.99","availability":"https://schema.org/InStock"}}
  </script></head></html>`;

test("extractOfferFromHtml reads an in-stock JSON-LD offer", () => {
  assert.deepEqual(extractOfferFromHtml(html), {
    price: 199.99,
    availability: "https://schema.org/InStock",
    priceValidUntil: null,
  });
});

test("validatePromotion accepts an unchanged offer", async () => {
  const result = await validatePromotion({
    origin: "promotion",
    source_url: "https://example.test/offer",
    fact_check: { expectedPrice: 199.99 },
  }, async () => new Response(html, { status: 200 }));
  assert.equal(result.valid, true);
  assert.equal(result.offer.price, 199.99);
});

test("validatePromotion blocks a changed price", async () => {
  const result = await validatePromotion({
    origin: "promotion",
    source_url: "https://example.test/offer",
    fact_check: { expectedPrice: 219.99 },
  }, async () => new Response(html, { status: 200 }));
  assert.equal(result.valid, false);
  assert.match(result.error, /preço mudou/);
});
