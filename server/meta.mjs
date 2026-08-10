import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config.mjs";

function assertMetaConfigured() {
  if (!config.meta.igUserId || !config.meta.accessToken) {
    throw new Error("Credenciais da Meta não configuradas");
  }
  if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL não configurada");
}

function absoluteMediaUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.publicBaseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function graph(path, params = {}, method = "POST") {
  assertMetaConfigured();
  const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: config.meta.accessToken });
  const response = await fetch(url, {
    method,
    ...(method === "GET"
      ? { headers: { Authorization: `Bearer ${config.meta.accessToken}` } }
      : { body }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta API respondeu ${response.status}`);
  }
  return payload;
}

async function graphGet(path, params = {}) {
  assertMetaConfigured();
  const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("access_token", config.meta.accessToken);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta API respondeu ${response.status}`);
  return payload;
}

async function waitForContainer(containerId, maxWaitMs = 180000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const state = await graphGet(containerId, { fields: "status_code,status" });
    if (state.status_code === "FINISHED") return state;
    if (["ERROR", "EXPIRED"].includes(state.status_code)) {
      throw new Error(`Contêiner da Meta falhou: ${state.status || state.status_code}`);
    }
    await delay(5000);
  }
  throw new Error("Tempo esgotado aguardando processamento do vídeo pela Meta");
}

async function publishContainer(creationId) {
  const published = await graph(`${config.meta.igUserId}/media_publish`, { creation_id: creationId });
  const details = await graphGet(published.id, { fields: "id,permalink,timestamp,media_type" });
  return { externalId: published.id, permalink: details.permalink || null, details };
}

async function createVideoContainer(params) {
  const created = await graph(`${config.meta.igUserId}/media`, params);
  await waitForContainer(created.id);
  return created.id;
}

export async function publishCarousel(content) {
  const children = [];
  for (const asset of content.media) {
    if (asset.type === "video") {
      children.push(
        await createVideoContainer({
          media_type: "VIDEO",
          video_url: absoluteMediaUrl(asset.url),
          is_carousel_item: "true",
        }),
      );
    } else {
      const child = await graph(`${config.meta.igUserId}/media`, {
        image_url: absoluteMediaUrl(asset.url),
        is_carousel_item: "true",
      });
      children.push(child.id);
    }
  }
  if (children.length < 2 || children.length > 10) {
    throw new Error("Carrossel precisa ter entre 2 e 10 mídias");
  }
  const parent = await graph(`${config.meta.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: content.caption,
  });
  return publishContainer(parent.id);
}

export async function publishReel(content) {
  const video = content.media.find((asset) => asset.type === "video");
  if (!video) throw new Error("Reel sem arquivo de vídeo");
  const creationId = await createVideoContainer({
    media_type: "REELS",
    video_url: absoluteMediaUrl(video.url),
    caption: content.caption,
    share_to_feed: "true",
  });
  return publishContainer(creationId);
}

export async function publishStory(content) {
  const video = content.media.find((asset) => asset.type === "video");
  if (!video) throw new Error("Story sem arquivo de vídeo");
  const creationId = await createVideoContainer({
    media_type: "STORIES",
    video_url: absoluteMediaUrl(video.url),
  });
  return publishContainer(creationId);
}

export async function publishToInstagram(kind, content) {
  if (kind === "carousel") return publishCarousel(content);
  if (kind === "reel") return publishReel(content);
  if (kind === "story") return publishStory(content);
  throw new Error(`Formato não suportado: ${kind}`);
}
