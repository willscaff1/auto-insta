"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import initialDashboard from "../public/dashboard-data.json";

type View = "resumo" | "fila" | "fontes";
type Filter = "todos" | "ready" | "queued" | "monitoring" | "published";
type PostStatus = Exclude<Filter, "todos">;

type Post = {
  id: string;
  title: string;
  kicker: string;
  format: string;
  status: PostStatus;
  sourceName: string;
  sourceUrl: string;
  image: string | null;
  scheduleLabel: string;
  publishedUrl?: string;
  note: string;
};

type DashboardData = {
  account: string;
  timezone: string;
  lastSync: string;
  stats: {
    published: number;
    ready: number;
    dailyTarget: number;
    tracked: number;
  };
  schedule: Array<{
    time: string;
    label: string;
    detail: string;
    type: "research" | "publish";
  }>;
  posts: Post[];
  sources: Array<{
    group: string;
    names: string;
    purpose: string;
    level: "primary" | "market" | "review";
  }>;
  monitoring: Array<{
    name: string;
    subject: string;
    status: string;
  }>;
};

const statusLabels: Record<PostStatus, string> = {
  published: "Publicado",
  ready: "Criativo pronto",
  queued: "Na fila",
  monitoring: "Em verificação",
};

const filterLabels: Array<{ id: Filter; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "ready", label: "Prontos" },
  { id: "queued", label: "Na fila" },
  { id: "monitoring", label: "Verificação" },
  { id: "published", label: "Publicados" },
];

const viewLabels: Array<{ id: View; label: string }> = [
  { id: "resumo", label: "Visão geral" },
  { id: "fila", label: "Fila editorial" },
  { id: "fontes", label: "Fontes" },
];

function getCuiabaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Cuiaba",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getNextWindow(date: Date) {
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Cuiaba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(timeParts.map((part) => [part.type, part.value]));
  const minutesNow = Number(values.hour) * 60 + Number(values.minute);
  const slots = [10 * 60, 19 * 60];
  const nextSlot = slots.find((slot) => slot > minutesNow) ?? slots[0] + 24 * 60;
  const remaining = nextSlot - minutesNow;

  return {
    time: nextSlot % (24 * 60) === 10 * 60 ? "10:00" : "19:00",
    label: nextSlot >= 24 * 60 ? "amanhã" : "hoje",
    countdown:
      remaining < 60
        ? `${remaining} min`
        : `${Math.floor(remaining / 60)}h ${remaining % 60}min`,
  };
}

function formatSync(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Cuiaba",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true" className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}

function QueueList({ posts }: { posts: Post[] }) {
  return (
    <div className="queue-list">
      {posts.map((post, index) => (
        <article className="queue-row" key={post.id}>
          <span className="queue-number">{String(index + 1).padStart(2, "0")}</span>
          {post.image ? (
            <Image
              className="queue-thumb"
              src={post.image}
              alt=""
              width={1080}
              height={1350}
              sizes="56px"
            />
          ) : (
            <div className="queue-thumb queue-thumb-empty" aria-hidden="true">
              AT
            </div>
          )}
          <div className="queue-copy">
            <p className="queue-kicker">{post.kicker}</p>
            <h3>{post.title}</h3>
            <p className="queue-meta">
              {post.format} <span aria-hidden="true">•</span> {post.sourceName}
            </p>
          </div>
          <div className="queue-state">
            <StatusBadge status={post.status} />
            <span>{post.scheduleLabel}</span>
          </div>
          <div className="queue-actions">
            {post.publishedUrl ? (
              <a href={post.publishedUrl} target="_blank" rel="noreferrer">
                Abrir post
              </a>
            ) : (
              <a href={post.sourceUrl} target="_blank" rel="noreferrer">
                Ver fonte
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData>(initialDashboard as DashboardData);
  const [view, setView] = useState<View>("resumo");
  const [filter, setFilter] = useState<Filter>("todos");
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/dashboard-data.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (response.ok) {
        setData((await response.json()) as DashboardData);
      }
    } finally {
      window.setTimeout(() => setRefreshing(false), 350);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const nextWindow = getNextWindow(now);
  const clock = getCuiabaParts(now);
  const visiblePosts = useMemo(
    () => data.posts.filter((post) => filter === "todos" || post.status === filter),
    [data.posts, filter],
  );
  const published = data.posts.find((post) => post.status === "published");
  const ready = data.posts.filter((post) => post.status === "ready").slice(0, 2);

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            AT
          </span>
          <div>
            <strong>AlertaTCG</strong>
            <span>Central editorial</span>
          </div>
        </div>
        <div className="topbar-status">
          <span className="live-indicator" aria-hidden="true" />
          Automação ativa
        </div>
        <div className="topbar-actions">
          <span className="timezone">Cuiabá · {clock.hour}:{clock.minute}</span>
          <button className="refresh-button" type="button" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Atualizando..." : "Atualizar dados"}
          </button>
          <a
            className="instagram-button"
            href="https://www.instagram.com/alertatcg/"
            target="_blank"
            rel="noreferrer"
          >
            Abrir Instagram
          </a>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Navegação principal">
          <div className="sidebar-section">
            <p className="sidebar-label">Painel</p>
            {viewLabels.map((item) => (
              <button
                className="nav-button"
                data-active={view === item.id}
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
              >
                <span className="nav-line" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>

          <div className="sidebar-section sidebar-lower">
            <p className="sidebar-label">Publicação</p>
            <div className="sidebar-fact">
              <span>Frequência</span>
              <strong>2x por dia</strong>
            </div>
            <div className="sidebar-fact">
              <span>Horários</span>
              <strong>10h · 19h</strong>
            </div>
            <div className="sidebar-fact">
              <span>Foco</span>
              <strong>80% TCG</strong>
            </div>
          </div>

          <div className="source-rule">
            <span>Regra editorial</span>
            <p>Preço só entra com moeda, data, condição e fonte verificável.</p>
          </div>
        </aside>

        <main>
          <nav className="mobile-tabs" aria-label="Seções do painel">
            {viewLabels.map((item) => (
              <button
                data-active={view === item.id}
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="page-heading">
            <div>
              <p className="eyebrow">{data.account} · OPERAÇÃO EDITORIAL</p>
              <h1>
                {view === "resumo" && "Visão geral"}
                {view === "fila" && "Fila de publicações"}
                {view === "fontes" && "Radar de fontes"}
              </h1>
            </div>
            <div className="sync-copy">
              <span>Última sincronização</span>
              <strong>{formatSync(data.lastSync)}</strong>
            </div>
          </section>

          {view === "resumo" && (
            <>
              <section className="metric-grid" aria-label="Resumo da operação">
                <article className="metric-card metric-yellow">
                  <span>Publicados</span>
                  <strong>{String(data.stats.published).padStart(2, "0")}</strong>
                  <small>no ciclo atual</small>
                </article>
                <article className="metric-card metric-cyan">
                  <span>Criativos prontos</span>
                  <strong>{String(data.stats.ready).padStart(2, "0")}</strong>
                  <small>aguardando gatilho</small>
                </article>
                <article className="metric-card metric-red">
                  <span>Meta diária</span>
                  <strong>{data.stats.dailyTarget}x</strong>
                  <small>10h e 19h</small>
                </article>
                <article className="metric-card metric-white">
                  <span>Pautas rastreadas</span>
                  <strong>{data.stats.tracked}</strong>
                  <small>TCG e Pokémon geral</small>
                </article>
              </section>

              <section className="schedule-band">
                <div className="next-window">
                  <p className="eyebrow">PRÓXIMA JANELA</p>
                  <div className="next-time">{nextWindow.time}</div>
                  <p>
                    {nextWindow.label} · em <strong>{nextWindow.countdown}</strong>
                  </p>
                  <span className="armed-label">Fila pronta para o gatilho</span>
                </div>
                <div className="daily-track">
                  <div className="section-title-row">
                    <div>
                      <p className="eyebrow">ROTINA DIÁRIA</p>
                      <h2>Pesquisa, checagem e publicação</h2>
                    </div>
                    <span>Horário de Cuiabá</span>
                  </div>
                  <div className="track-line">
                    {data.schedule.map((slot) => (
                      <article className={`track-step track-${slot.type}`} key={`${slot.time}-${slot.label}`}>
                        <span className="track-dot" aria-hidden="true" />
                        <strong>{slot.time}</strong>
                        <h3>{slot.label}</h3>
                        <p>{slot.detail}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </section>

              <section className="today-layout">
                <div className="today-queue">
                  <div className="section-title-row">
                    <div>
                      <p className="eyebrow">NO GATILHO</p>
                      <h2>Próximos carrosséis</h2>
                    </div>
                    <button className="text-button" type="button" onClick={() => setView("fila")}>
                      Ver fila completa
                    </button>
                  </div>
                  <div className="ready-grid">
                    {ready.map((post) => (
                      <article className="creative-card" key={post.id}>
                        {post.image && (
                          <Image
                            src={post.image}
                            alt={`Capa do carrossel: ${post.title}`}
                            width={1080}
                            height={1350}
                            sizes="(max-width: 600px) 112px, 180px"
                          />
                        )}
                        <div className="creative-copy">
                          <StatusBadge status={post.status} />
                          <p>{post.kicker}</p>
                          <h3>{post.title}</h3>
                          <div className="creative-footer">
                            <span>{post.format}</span>
                            <a href={post.sourceUrl} target="_blank" rel="noreferrer">
                              Conferir fonte
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                {published && (
                  <aside className="published-panel">
                    <div className="section-title-row">
                      <div>
                        <p className="eyebrow">MAIS RECENTE</p>
                        <h2>Já no ar</h2>
                      </div>
                      <StatusBadge status="published" />
                    </div>
                    {published.image && (
                      <Image
                        src={published.image}
                        alt={`Capa publicada: ${published.title}`}
                        width={1080}
                        height={1350}
                        sizes="(max-width: 860px) 100vw, 28vw"
                      />
                    )}
                    <p className="published-kicker">{published.kicker}</p>
                    <h3>{published.title}</h3>
                    <p className="published-note">{published.note}</p>
                    {published.publishedUrl && (
                      <a
                        className="primary-link"
                        href={published.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver publicação no Instagram
                      </a>
                    )}
                  </aside>
                )}
              </section>
            </>
          )}

          {view === "fila" && (
            <section className="queue-section">
              <div className="filter-bar" aria-label="Filtros da fila">
                {filterLabels.map((item) => (
                  <button
                    data-active={filter === item.id}
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="queue-header" aria-hidden="true">
                <span>Ordem</span>
                <span>Pauta</span>
                <span>Status</span>
                <span>Ação</span>
              </div>
              <QueueList posts={visiblePosts} />
              {visiblePosts.length === 0 && (
                <p className="empty-state">Nenhuma pauta com esse status.</p>
              )}
            </section>
          )}

          {view === "fontes" && (
            <section className="sources-layout">
              <div className="source-table">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">HIERARQUIA DE CONFIANÇA</p>
                    <h2>Fontes em uso</h2>
                  </div>
                  <span>{data.sources.length} grupos ativos</span>
                </div>
                {data.sources.map((source) => (
                  <article className="source-row" key={source.group}>
                    <span className={`source-level level-${source.level}`}>
                      {source.level === "primary" && "Primária"}
                      {source.level === "market" && "Mercado"}
                      {source.level === "review" && "Checagem"}
                    </span>
                    <div>
                      <p>{source.group}</p>
                      <h3>{source.names}</h3>
                      <span>{source.purpose}</span>
                    </div>
                  </article>
                ))}
              </div>

              <aside className="monitoring-panel">
                <p className="eyebrow">NOMES MONITORADOS</p>
                <h2>Influenciadores</h2>
                <p className="monitoring-intro">
                  Só entram no calendário depois de publicação original ou confirmação independente.
                </p>
                {data.monitoring.map((item) => (
                  <article className="monitor-row" key={item.name}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.subject}</span>
                    </div>
                    <span className="review-chip">{item.status}</span>
                  </article>
                ))}
              </aside>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
