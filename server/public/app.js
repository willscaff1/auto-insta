const state = { data: null, filter: "all", apiKey: sessionStorage.getItem("alertatcg-key") || "" };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const statusLabels = {
  scheduled: "Agendado", processing: "Publicando", waiting_credentials: "Aguardando acesso",
  retry: "Nova tentativa", published: "Publicado", failed: "Falhou", cancelled: "Cancelado",
  ready: "Pronto",
};
const kindLabels = { carousel: "Carrossel", reel: "Reel", story: "Story" };

function headers() { return state.apiKey ? { Authorization: `Bearer ${state.apiKey}` } : {}; }
function formatDate(value, options = {}) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", ...options }).format(new Date(value)); }
function cover(job) {
  const video = job.content.media?.find((asset) => asset.type === "video");
  return video?.coverUrl || job.content.media?.find((asset) => asset.type === "image")?.url || "";
}
function esc(value = "") { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }

async function loadData(showDialog = true) {
  const button = $("#refreshButton");
  button.disabled = true;
  try {
    const response = await fetch("/api/dashboard", { headers: headers(), cache: "no-store" });
    if (response.status === 401) {
      if (showDialog) $("#accessDialog").showModal();
      return false;
    }
    if (!response.ok) throw new Error("Não foi possível atualizar o painel");
    state.data = await response.json();
    render();
    return true;
  } finally { button.disabled = false; }
}

function render() {
  const { stats, runtime, jobs, readyItems = [], events, lastSync } = state.data;
  $("#lastSync").textContent = formatDate(lastSync, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  $("#scheduledCount").textContent = String(stats.scheduled).padStart(2, "0");
  $("#readyCount").textContent = String(stats.ready).padStart(2, "0");
  $("#publishedCount").textContent = String(stats.published).padStart(2, "0");
  $("#failedCount").textContent = String(stats.failed).padStart(2, "0");
  const operational = runtime.scheduler && runtime.database.connected;
  $("#serviceLight").className = `status-light ${operational ? (runtime.publishingMode === "live" ? "live" : "warning") : ""}`;
  $("#serviceLabel").textContent = operational ? (runtime.publishingMode === "live" ? "Publicação automática ativa" : "Agenda ativa em simulação") : "Configuração em andamento";
  $("#modeLabel").textContent = runtime.publishingMode === "live" ? "Publicação real" : "Simulação protegida";
  renderNext(jobs);
  renderTimeline(jobs);
  renderCreatives(jobs, readyItems);
  renderCalendar(jobs);
  renderQueue(jobs, readyItems, runtime);
  renderHealth(runtime);
  renderEvents(events);
}

function renderNext(jobs) {
  const next = jobs.find((job) => !["published", "cancelled", "failed"].includes(job.status));
  if (!next) return;
  $("#nextTime").textContent = formatDate(next.scheduledFor, { hour: "2-digit", minute: "2-digit" });
  $("#nextDate").textContent = formatDate(next.scheduledFor, { weekday: "long", day: "2-digit", month: "long" });
  $("#nextContent").innerHTML = `
    <img class="next-cover" src="${esc(cover(next))}" alt="Capa de ${esc(next.content.title)}">
    <div class="next-copy"><p class="kicker">${esc(next.content.kicker)}</p><h2>${esc(next.content.title)}</h2><p>Fonte: ${esc(next.content.sourceName)} · ${next.attempts ? `${next.attempts} tentativa(s)` : "pronto para publicar"}</p></div>
    <span class="format-badge">${kindLabels[next.kind]}</span>`;
}

function renderTimeline(jobs) {
  const upcoming = jobs.filter((job) => !["published", "cancelled"].includes(job.status)).slice(0, 3);
  $("#timeline").innerHTML = upcoming.length ? upcoming.map((job) => `
    <article class="timeline-item"><time>${formatDate(job.scheduledFor, { hour: "2-digit", minute: "2-digit" })}</time><h3>${esc(job.content.title)}</h3><p>${kindLabels[job.kind]} · ${formatDate(job.scheduledFor, { weekday: "short", day: "2-digit", month: "short" })}</p></article>`).join("") : '<p class="empty-line">Nenhum horário carregado.</p>';
}

function readyJob(content) {
  return { id: `ready-${content.slug}`, kind: "carousel", status: "ready", scheduledFor: null, content };
}

function renderCreatives(jobs, readyItems) {
  const combined = [...jobs, ...readyItems.map(readyJob)];
  const unique = [...new Map(combined.map((job) => [job.content.slug, job])).values()].slice(-4).reverse();
  $("#creativeGrid").innerHTML = unique.map((job) => `
    <article class="creative-card"><img src="${esc(cover(job))}" alt="Capa de ${esc(job.content.title)}"><div class="creative-copy"><p class="kicker">${esc(job.content.kicker)}</p><h3>${esc(job.content.title)}</h3><div class="creative-meta"><span>${kindLabels[job.kind]}</span><span>${job.scheduledFor ? formatDate(job.scheduledFor, { day: "2-digit", month: "short" }) : "Pronto"}</span></div></div></article>`).join("");
}

function renderCalendar(jobs) {
  const grouped = new Map();
  jobs.filter((job) => job.status !== "cancelled").forEach((job) => {
    const key = formatDate(job.scheduledFor, { year: "numeric", month: "2-digit", day: "2-digit" });
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(job);
  });
  $("#calendarList").innerHTML = [...grouped.entries()].map(([, dayJobs]) => {
    const first = dayJobs[0];
    return `<section class="calendar-day"><div class="day-label"><strong>${formatDate(first.scheduledFor, { weekday: "short" })}</strong><span>${formatDate(first.scheduledFor, { day: "2-digit", month: "long" })}</span></div><div class="day-jobs">${dayJobs.map((job) => `<article class="calendar-job ${job.kind}"><time>${formatDate(job.scheduledFor, { hour: "2-digit", minute: "2-digit" })} · ${kindLabels[job.kind]}</time><h3>${esc(job.content.title)}</h3><p>${statusLabels[job.status] || job.status}</p></article>`).join("")}</div></section>`;
  }).join("") || '<p class="empty-line">O calendário será preenchido ao conectar o banco.</p>';
}

function renderQueue(jobs, readyItems = []) {
  const combined = [...readyItems.map(readyJob), ...jobs];
  const filtered = combined.filter((job) => state.filter === "all" || job.kind === state.filter || job.status === state.filter);
  $("#queueList").innerHTML = filtered.map((job, index) => `
    <article class="queue-row"><span class="queue-index">${String(index + 1).padStart(2, "0")}</span><img class="queue-thumb" src="${esc(cover(job))}" alt=""><div class="queue-copy"><p class="kicker">${esc(job.content.kicker)}</p><h3>${esc(job.content.title)}</h3><p>${esc(job.content.sourceName)}</p></div><div class="job-schedule"><strong>${job.scheduledFor ? formatDate(job.scheduledFor, { hour: "2-digit", minute: "2-digit" }) : "NO GATILHO"}</strong><span>${job.scheduledFor ? `${formatDate(job.scheduledFor, { day: "2-digit", month: "short" })} · ${kindLabels[job.kind]}` : "Carrossel pronto"}</span></div><span class="status-badge ${job.status}">${statusLabels[job.status] || job.status}</span></article>`).join("") || '<p class="empty-line">Nenhuma publicação neste filtro.</p>';
}

function renderHealth(runtime) {
  const checks = [
    ["Railway", true, "Serviço web", "Disponível enquanto o deploy estiver saudável."],
    ["PostgreSQL", runtime.database.connected, "Banco da fila", runtime.database.connected ? "Histórico e calendário persistentes." : "Adicionar o serviço PostgreSQL."],
    ["Agendador", runtime.scheduler, "Rotina 24/7", runtime.scheduler ? "Verifica a fila a cada 30 segundos." : "Ativar SCHEDULER_ENABLED."],
    ["Meta Instagram", runtime.credentials.meta, "Feed, Reels e Stories", runtime.credentials.meta ? "Conta profissional conectada." : "Conectar token e ID da conta profissional."],
    ["Endereço público", runtime.credentials.publicUrl, "Entrega de mídia", runtime.credentials.publicUrl ? "Arquivos acessíveis pela Meta." : "Informar PUBLIC_BASE_URL após o deploy."],
    ["Pesquisa diária", runtime.research?.enabled && runtime.credentials.openai, "Reposição da fila", runtime.research?.enabled ? "Pesquisa automática configurada." : "Ativar após informar a chave da OpenAI."],
  ];
  $("#healthGrid").innerHTML = checks.map(([name, ok, label, detail]) => `<article class="health-item ${ok ? "ok" : ""}"><span class="health-light"></span><div><h3>${name}</h3><p>${detail}</p></div><strong>${ok ? label : "Pendente"}</strong></article>`).join("");
}

function renderEvents(events) {
  $("#eventList").innerHTML = events.map((event) => `<article class="event-row"><time>${formatDate(event.createdAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span class="event-level ${event.level}">${event.level}</span><p>${esc(event.message)}</p></article>`).join("") || '<p class="empty-line">Os eventos aparecerão depois da primeira inicialização.</p>';
}

function switchView(view) {
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
  $(".sidebar").classList.remove("open");
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-jump]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.jump)));
$("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#refreshButton").addEventListener("click", () => loadData());
$("#filters").addEventListener("click", (event) => { if (!event.target.dataset.filter) return; $$("#filters button").forEach((button) => button.classList.toggle("active", button === event.target)); state.filter = event.target.dataset.filter; renderQueue(state.data.jobs, state.data.readyItems); });
$("#accessForm").addEventListener("submit", async (event) => { event.preventDefault(); state.apiKey = $("#apiKeyInput").value.trim(); if (await loadData(false)) { sessionStorage.setItem("alertatcg-key", state.apiKey); $("#accessDialog").close(); $("#formError").textContent = ""; } else { $("#formError").textContent = "Chave incorreta."; } });

function updateClock() { $("#clock").textContent = `${formatDate(new Date(), { weekday: "short", day: "2-digit", month: "short" })} · ${formatDate(new Date(), { hour: "2-digit", minute: "2-digit" })}`; }
updateClock(); setInterval(updateClock, 30_000); loadData();
