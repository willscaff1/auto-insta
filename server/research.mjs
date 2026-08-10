import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.mjs";
import { recordEvent, upsertContent } from "./db.mjs";
import { renderCampaign } from "./renderer.mjs";

const allowedDomains = [
  "pokemon.com", "worlds.pokemon.com", "psacard.com", "cgccards.com",
  "goldin.co", "ha.com", "fanaticscollect.com", "copag.com.br",
];

const researchSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{5,80}$/),
  title: z.string().min(20).max(110),
  kicker: z.string().min(4).max(36),
  caption: z.string().min(350).max(2100),
  sourceName: z.string().min(3).max(80),
  sourceUrl: z.string().url(),
  sourcePublishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  imageUrl: z.string().url().optional(),
  slides: z.array(z.string().min(18).max(120)).length(7),
  factCheck: z.object({
    claim: z.string(),
    evidence: z.string(),
    terminologyChecked: z.boolean(),
    priceIsConfirmedSale: z.boolean().nullable(),
  }),
});

function validateDomain(url) {
  const host = new URL(url).hostname.toLowerCase();
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export async function researchOneTopic({ existingTitles = [] } = {}) {
  if (!config.research.enabled || !config.research.apiKey) {
    return { skipped: true, reason: "Pesquisa automática não configurada" };
  }
  const client = new OpenAI({ apiKey: config.research.apiKey });
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Você é o pesquisador factual do Instagram @alertatcg. Hoje é ${today}.
Pesquise UMA notícia ou curiosidade verdadeira, atual e inédita. Prioridade: 80% Pokémon TCG e 20% Pokémon geral.
Use somente fonte primária de um destes domínios: ${allowedDomains.join(", ")}.
Não use rumor. Não trate anúncio como venda. Diferencie lance, taxa, preço pedido, estimativa e venda confirmada. Não prometa investimento.
Evite estes títulos já usados: ${existingTitles.join(" | ")}.
Entregue apenas JSON válido, sem markdown, com: slug, title, kicker, caption, sourceName, sourceUrl, sourcePublishedAt, imageUrl opcional, slides (exatamente 7 textos; o primeiro repete o gancho da capa) e factCheck {claim,evidence,terminologyChecked,priceIsConfirmedSale}.
A legenda deve conter gancho, explicação, data, pergunta, fonte e 8 a 12 hashtags específicas. Escreva em português do Brasil.`;
  const response = await client.responses.create({
    model: config.research.model,
    tools: [{ type: "web_search" }],
    input: prompt,
    store: false,
  });
  const candidate = researchSchema.parse(parseJson(response.output_text));
  if (!validateDomain(candidate.sourceUrl)) throw new Error("Pesquisa retornou fonte fora da lista permitida");
  if (candidate.imageUrl && !validateDomain(candidate.imageUrl)) delete candidate.imageUrl;

  const status = config.research.autoApprove ? "ready" : "review";
  let media = [];
  if (config.research.autoApprove) media = await renderCampaign(candidate);
  const saved = await upsertContent({ ...candidate, media, status, origin: "openai-research" });
  await recordEvent("info", "research_created", `Nova pauta pesquisada: ${candidate.title}`, {
    contentId: saved.id,
    sourceUrl: candidate.sourceUrl,
    status,
  });
  return { skipped: false, content: saved };
}
