import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350;
const officialHosts = [
  "pokemon.com",
  "www.pokemon.com",
  "worlds.pokemon.com",
  "psacard.com",
  "www.psacard.com",
  "guinnessworldrecords.com",
  "www.guinnessworldrecords.com",
  "goldin.co",
  "www.goldin.co",
  "ha.com",
  "www.ha.com",
  "cgccards.com",
  "www.cgccards.com",
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value, max = 25, maxLines = 4) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, Math.max(1, max - 2))}…`;
    return clipped;
  }
  return lines;
}

function hostAllowed(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return officialHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

async function fetchBuffer(url) {
  if (!hostAllowed(url)) throw new Error("Imagem fora da lista de fontes permitidas");
  const response = await fetch(url, { headers: { "User-Agent": "AlertaTCG/1.0" } });
  if (!response.ok) throw new Error(`Não foi possível baixar a imagem oficial (${response.status})`);
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("URL oficial não retornou uma imagem");
  return Buffer.from(await response.arrayBuffer());
}

async function discoverOgImage(sourceUrl) {
  if (!hostAllowed(sourceUrl)) throw new Error("Fonte fora da lista permitida");
  const response = await fetch(sourceUrl, { headers: { "User-Agent": "AlertaTCG/1.0" } });
  if (!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
  const html = await response.text();
  const match = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
  if (!match) throw new Error("Fonte não informou uma imagem oficial de destaque");
  return new URL(match[1], sourceUrl).href;
}

function svgOverlay({ kicker, text, page, sourceName, cover = false }) {
  const titleLines = wrapText(text, cover ? 22 : 28, cover ? 4 : 5);
  const fontSize = cover ? 76 : 58;
  const startY = cover ? 190 : 176;
  const lineHeight = cover ? 82 : 67;
  const title = titleLines
    .map((line, index) => `<text x="72" y="${startY + index * lineHeight}" class="title">${escapeXml(line)}</text>`)
    .join("");

  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .brand { font: 900 30px Arial, sans-serif; fill: #f5f2e9; }
        .tag { font: 900 24px Arial, sans-serif; fill: #111214; }
        .title { font: 900 ${fontSize}px Arial, sans-serif; fill: #ffffff; }
        .source { font: 700 21px Arial, sans-serif; fill: #bec3c9; }
        .page { font: 900 22px Arial, sans-serif; fill: #111214; }
      </style>
      <rect width="1080" height="1350" fill="#101216" fill-opacity="0.44"/>
      <rect x="0" y="0" width="1080" height="14" fill="#f3d531"/>
      <rect x="72" y="74" width="${Math.min(740, 54 + kicker.length * 15)}" height="46" rx="4" fill="#f3d531"/>
      <text x="94" y="106" class="tag">${escapeXml(kicker.toUpperCase())}</text>
      ${title}
      <rect x="72" y="1170" width="936" height="1" fill="#50545b"/>
      <circle cx="84" cy="1225" r="8" fill="#ef4b3f"/>
      <text x="105" y="1235" class="brand">ALERTATCG</text>
      <text x="72" y="1295" class="source">Fonte: ${escapeXml(sourceName)}</text>
      <rect x="926" y="1197" width="82" height="48" rx="4" fill="#42c8de"/>
      <text x="967" y="1229" text-anchor="middle" class="page">${String(page).padStart(2, "0")}/07</text>
      ${Array.from({ length: 7 }, (_, i) => `<circle cx="${854 + i * 22}" cy="1286" r="${i + 1 === page ? 6 : 4}" fill="${i + 1 === page ? "#f3d531" : "#737780"}"/>`).join("")}
    </svg>`);
}

async function createSlide(image, outputPath, copy) {
  const background = await sharp(image)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .blur(28)
    .modulate({ brightness: 0.5, saturation: 0.7 })
    .png()
    .toBuffer();
  const featured = await sharp(image)
    .resize(760, 610, { fit: "contain", withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(background)
    .composite([
      { input: featured, gravity: "south", top: 550, left: 160 },
      { input: svgOverlay(copy), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 8 })
    .toFile(outputPath);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("FFmpeg não disponível"));
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-1200))));
  });
}

export async function renderCampaign(item) {
  const imageUrl = item.imageUrl || await discoverOgImage(item.sourceUrl);
  const image = await fetchBuffer(imageUrl);
  const directory = path.resolve("server", "public", "media", "generated", item.slug);
  await mkdir(directory, { recursive: true });
  const slideCopy = [item.title, ...item.slides.slice(1, 7)];

  for (let index = 0; index < 7; index += 1) {
    await createSlide(image, path.join(directory, `${String(index + 1).padStart(2, "0")}.png`), {
      kicker: item.kicker,
      text: slideCopy[index] || item.title,
      page: index + 1,
      sourceName: item.sourceName,
      cover: index === 0,
    });
  }

  await sharp(path.join(directory, "01.png")).jpeg({ quality: 90 }).toFile(path.join(directory, "cover.jpg"));
  const musicPath = path.resolve("server", "assets", "alertatcg-music.wav");
  const videoPath = path.join(directory, "reel.mp4");
  const duration = "19.6";
  let musicAvailable = true;
  try { await readFile(musicPath); } catch { musicAvailable = false; }
  const args = [
    "-y", "-framerate", "0.357142857", "-start_number", "1", "-i", path.join(directory, "%02d.png"),
  ];
  if (musicAvailable) args.push("-stream_loop", "-1", "-i", musicPath);
  args.push(
    "-t", duration,
    "-vf", `scale=${WIDTH}:${HEIGHT},format=yuv420p`,
    "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  );
  if (musicAvailable) args.push("-c:a", "aac", "-b:a", "160k", "-shortest");
  args.push("-movflags", "+faststart", videoPath);
  await runFfmpeg(args);

  await writeFile(path.join(directory, "source.json"), JSON.stringify({ sourceUrl: item.sourceUrl, imageUrl }, null, 2));
  const base = `/media/generated/${item.slug}`;
  return [
    { type: "video", url: `${base}/reel.mp4`, coverUrl: `${base}/cover.jpg` },
    ...Array.from({ length: 6 }, (_, index) => ({ type: "image", url: `${base}/${String(index + 2).padStart(2, "0")}.png` })),
  ];
}
