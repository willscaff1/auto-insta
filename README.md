# AlertaTCG Ops

Painel e serviço de publicação do Instagram `@alertatcg`, preparado para rodar 24 horas no Railway com PostgreSQL.

## O que já está incluído

- calendário em `America/Cuiaba`;
- carrossel às 10h, Reel às 19h e Story às 19h10;
- 10 campanhas iniciais verificadas, com mídia 4:5, legenda e fonte;
- publicação pela Instagram Graph API;
- repetição automática com histórico de tentativas;
- pesquisa diária opcional com OpenAI e lista fechada de fontes;
- geração automática de criativos no padrão visual AlertaTCG;
- painel privado protegido por `ADMIN_API_KEY`;
- modo `dry_run` para validar tudo sem publicar.

## Rodar o serviço

```bash
npm install
cp .env.example .env
npm run service:start
```

O serviço abre em `http://localhost:3000`. O endpoint de saúde é `/health`.

## Banco inicial

Com `DATABASE_URL` configurada:

```bash
npm run service:seed
```

O seed cria o calendário inicial de cinco dias: dois conteúdos de Feed por dia e um Story diário derivado do Reel. A pesquisa das 7h repõe a fila para manter no mínimo 10 conteúdos futuros.

## Variáveis do Railway

Use `.env.example` como referência. A ordem recomendada é:

1. adicionar PostgreSQL e confirmar `DATABASE_URL`;
2. publicar com `PUBLISHING_MODE=dry_run`;
3. definir `PUBLIC_BASE_URL` com o domínio gerado pelo Railway;
4. conectar `META_IG_USER_ID` e `META_ACCESS_TOKEN`;
5. rodar o seed e conferir o painel;
6. trocar `PUBLISHING_MODE=live`;
7. ativar pesquisa com `AUTO_RESEARCH_ENABLED=true`;
8. deixar `AUTO_APPROVE_RESEARCH=false` até validar as primeiras pautas automáticas.

## Segurança editorial

O pesquisador automático só aceita fontes permitidas e separa venda confirmada, lance, taxa, estimativa e preço anunciado. Conteúdos sobre pessoas públicas exigem confirmação independente e não entram no fluxo automático sem verificação.

O Instagram não permite escolher músicas comerciais da biblioteca pelo Graph API. Os vídeos publicados automaticamente usam a trilha original incorporada ao arquivo. A mesma mídia pode ser enviada como Story, mas não como um compartilhamento nativo do Reel com adesivo.

## Painel do Sites

O painel privado existente em Sites continua disponível durante a migração. Os comandos `npm run dev` e `npm run build` permanecem reservados para essa versão.

## Campanha atual

Thiago Nigro e o Charizard TAG 10 de US$ 700 mil: publicada em 11/08/2026 e registrada no painel com fontes verificadas, vídeo de abertura, capa JPG e seis imagens.
