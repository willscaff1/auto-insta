function walk(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(value);
  Object.values(value).forEach((item) => walk(item, visit));
}

function asNumber(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractOfferFromHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const offers = [];

  for (const match of scripts) {
    try {
      const data = JSON.parse(match[1].trim());
      walk(data, (item) => {
        const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : String(item["@type"] || "");
        if (!/Offer/i.test(type) && item.price == null && item.lowPrice == null) return;
        const price = asNumber(item.price ?? item.lowPrice);
        if (price == null) return;
        offers.push({
          price,
          availability: String(item.availability || ""),
          priceValidUntil: item.priceValidUntil || null,
        });
      });
    } catch {
      // A malformed block must not hide other valid JSON-LD blocks on the page.
    }
  }

  if (!offers.length) return null;
  return offers.find((offer) => /InStock$/i.test(offer.availability)) || offers[0];
}

function parseFactCheck(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

export async function validatePromotion(content, fetchImpl = fetch) {
  if (content.origin !== "promotion") return { valid: true, skipped: true };

  const factCheck = parseFactCheck(content.fact_check ?? content.factCheck);
  const expectedPrice = asNumber(factCheck.expectedPrice);
  if (!content.source_url || expectedPrice == null) {
    return { valid: false, retryable: false, error: "Promoção sem URL ou preço esperado para validação" };
  }

  let response;
  try {
    response = await fetchImpl(content.source_url, {
      headers: { "user-agent": "Mozilla/5.0 AlertaTCG/1.0 price-check" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { valid: false, retryable: true, error: `Não foi possível consultar a oferta: ${error.message}` };
  }
  if (!response.ok) {
    return { valid: false, retryable: true, error: `Loja respondeu HTTP ${response.status}` };
  }

  const offer = extractOfferFromHtml(await response.text());
  if (!offer) {
    return { valid: false, retryable: true, error: "A loja não apresentou preço estruturado verificável" };
  }

  const available = /InStock$/i.test(offer.availability);
  const samePrice = Math.abs(offer.price - expectedPrice) < 0.01;
  if (!available || !samePrice) {
    const reason = !available
      ? "oferta sem estoque"
      : `preço mudou de R$ ${expectedPrice.toFixed(2)} para R$ ${offer.price.toFixed(2)}`;
    return { valid: false, retryable: false, error: `Publicação bloqueada: ${reason}`, offer };
  }

  return { valid: true, checkedAt: new Date().toISOString(), offer };
}
