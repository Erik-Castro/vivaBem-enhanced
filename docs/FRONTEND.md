# Frontend (Fase 10)

SPA em **Svelte 5 + Vite 7 + TypeScript + PWA**, servida por Nginx no Compose e
consumindo a API em `/api/v1` pela mesma origem.

- Código: `web/`
- Build estático: `web/dist/` (não versionado)
- Container: `web/Dockerfile` + `web/nginx.conf`
- Plano: [`PLAN.md`](PLAN.md) — Fase 10

---

## 1. Stack e decisões

| Tema | Decisão |
|---|---|
| Framework | Svelte 5 com runes (`$state`, `$derived`, `$effect`, `$props`) |
| Build | Vite 7.3.8 + `@sveltejs/vite-plugin-svelte` 6.2.4 |
| PWA | `vite-plugin-pwa` 2 (`generateSW`, Workbox) |
| Rotas | Hash routing (`#/dashboard`), sem servidor de rotas |
| Estilo | CSS próprio com design tokens; sem Tailwind nem biblioteca de componentes |
| Ícones | SVG locais em `web/src/lib/icons.ts` |
| Fontes | Somente fontes do sistema |
| Dinheiro | Inteiro em minor units + `Intl.NumberFormat("pt-BR")` |
| HTTP | `fetch` nativo com cookies (`credentials: "include"`) |

**Vite 7, não 8.** O Vite 8 usa Rolldown, que exige instruções além de AVX e
aborta com `Illegal instruction` em CPUs AVX-only (ex.: i7-2600). O
`package.json` fixa `vite@^7.3.8`, `@sveltejs/vite-plugin-svelte@^6.2.4` e
`"overrides": { "rollup": "4.68.0" }` porque o tarball do rollup 4.68.2 não está
disponível no registry. Não suba essas versões sem testar em CPU sem AVX2.

---

## 2. Requisitos e comandos

- Node **20.19+** ou **22.12+** (exigência do Vite 7)
- npm 10+

```bash
make web-install     # cd web && npm ci
make web-dev         # Vite em http://localhost:5173 (proxy para :3000)
make web-check       # svelte-check (typecheck de .svelte e .ts)
make web-build       # build de produção em web/dist
```

Ou diretamente em `web/`:

```bash
npm ci
npm run dev       # servidor de desenvolvimento
npm run check     # svelte-check
npm run build     # build + PWA
npm run preview   # serve dist em http://localhost:4173 com o mesmo proxy
```

O `preview` existe para validar o build de produção (service worker, manifest,
CSP) sem Docker.

---

## 3. Origem e CSRF

A API valida `Origin` **exatamente** contra `APP_ORIGIN` em métodos mutáveis.
Use sempre `http://localhost` (não `127.0.0.1`) e o mesmo valor nas duas pontas:

| Cenário | `APP_ORIGIN` | Onde rodar |
|---|---|---|
| Desenvolvimento | `http://localhost:5173` | `deno task start` + `npm run dev` |
| Build de produção local | `http://localhost:4173` | `deno task start` + `npm run preview` |
| Compose | `http://localhost:8080` | `docker compose up -d --build` |

O proxy do Vite (`server.proxy` e `preview.proxy`) mantém o header `Origin`
original, encaminhando `/api`, `/health` e `/ready` para `127.0.0.1:3000`.

---

## 4. Estrutura

```text
web/
  index.html            # shell da SPA
  vite.config.ts        # Svelte + PWA + proxy de dev/preview
  nginx.conf            # SPA fallback, proxy /api, headers e cache
  Dockerfile            # build (Node 24) + runtime (nginx-unprivileged)
  public/               # favicons, ícones PNG/SVG e manifest assets
  src/
    main.ts             # monta o App
    App.svelte          # guards de rota e composição das páginas
    app.css             # design tokens, layout e responsividade
    lib/
      api.ts            # fetch tipado, CSRF, refresh e erros
      auth.svelte.ts    # store de sessão (login, register, logout, init)
      router.svelte.ts  # hash router reativo
      theme.svelte.ts   # tema claro/escuro persistido
      toast.svelte.ts   # fila de notificações
      format.ts         # dinheiro (minor units), datas, input
      labels.ts         # rótulos e ícones de domínio
      types.ts          # tipos do contrato da API
      icons.ts          # ícones SVG inline
    components/         # AppShell, modais, linha de transação, toasts
    pages/              # Login, Register, Dashboard, Accounts, Transactions,
                        # Categories, Budgets, Goals, Settings, ComingSoon,
                        # NotFound
```

### 4.1 Rotas

| Rota | Autenticada | Estado |
|---|---|---|
| `#/login` | não | Login |
| `#/register` | não | Cadastro |
| `#/dashboard` | sim | Resumo do mês, saldos e últimas transações |
| `#/accounts` | sim | Contas, cartões, saldo e ativação |
| `#/transactions` | sim | Lista, filtros, criação, edição, remoção, compensação e transferência |
| `#/categories` | sim | Árvore de categorias e subcategorias |
| `#/budgets` | sim | Orçamentos por mês, progresso, alertas e ativação |
| `#/goals` | sim | Metas por status, progresso e contribuições |
| `#/settings` | sim | Perfil, preferências, sessões e sair |
| `#/habits`, `#/investments`, `#/achievements` | sim | Placeholder "em breve" |
| qualquer outra | sim | Página não encontrada |

Rotas públicas redirecionam usuários autenticados para o painel; rotas
protegidas redirecionam visitantes para o login. O estado `auth.ready` evita
piscar a tela de login durante o bootstrap.

### 4.2 Estado

- Estado global apenas onde precisa ser global: `auth`, `router`, `theme` e
  `toasts` (arquivos `.svelte.ts` com runes).
- Dados de tela são locais à página (`$state`) e recarregados após mutações.
- Nada de store genérica, cache global de dados ou estado derivado duplicado.

### 4.3 API client

`web/src/lib/api.ts` concentra:

- URL base relativa (`/api/v1`) e `credentials: "include"`.
- Bootstrap do CSRF via `GET /auth/csrf` (cookie `vb_csrf`).
- Envio de `X-CSRF-Token` em métodos mutáveis.
- `refresh` com *single-flight*: uma única chamada concorrente; em `401`, tenta
  renovar uma vez e repete a requisição original.
- Tradução de erros da API (`error.code`, `error.message`, `details`) para uma
  mensagem exibível.
- `ApiError` com `status`, `code` e `details`.

### 4.4 Autenticação

O frontend nunca lê tokens: `vb_access` e `vb_refresh` são HttpOnly. O fluxo é:

1. `auth.init()` chama `GET /me`; se falhar, tenta `POST /auth/refresh`.
2. Login/registro recebem `{ user, csrfToken }` e atualizam o store.
3. Logout chama `POST /auth/logout` e limpa o estado local.
4. Revogar a sessão corrente na tela de configurações encerra a sessão e volta
   para o login.

### 4.5 Dinheiro e datas

- Valores chegam em `amountMinor` + `currencyCode` e nunca são convertidos para
  `float`; a formatação usa `Intl.NumberFormat` e a entrada é convertida por
  `toMinorUnits` (aceita vírgula e ponto).
- Datas de negócio são `YYYY-MM-DD`; a exibição usa `Intl.DateTimeFormat` e o
  fuso do navegador.
- O formulário de transação envia a data no formato de negócio (sem hora).

---

## 5. Tema e acessibilidade

- Tokens em `app.css` para cores, espaçamento, raios, sombras e tipografia.
- Tema claro/escuro em `data-theme` no `<html>`, persistido em
  `localStorage["vivabem-theme"]` e aplicado quando o bundle carrega (sem script
  inline, para caber na CSP `script-src 'self'`). Em modo escuro o
  `theme-color` do manifest também muda.
- Componentes usam elementos nativos (`button`, `label`, `select`), foco visível,
  `aria-*` nos modais e mensagens de erro com `role="alert"`.
- Layout responsivo: sidebar no desktop, navegação inferior no mobile (≤ 900px),
  sem overflow horizontal em 390px. No mobile, cinco atalhos fixos (Painel,
  Transações, Contas, Orçamentos e Metas) e um menu "Mais" em bottom sheet com
  as demais rotas.

---

## 6. PWA

- `vite-plugin-pwa` gera `sw.js`, `manifest.webmanifest` e o precache do app
  shell (HTML, JS, CSS, ícones).
- Estratégia: `generateSW`, `navigateFallback: "/index.html"`,
  `cleanupOutdatedCaches: true`.
- **A API não é cacheada**: apenas o shell é precached; chamadas `/api/**` vão
  sempre para a rede.
- Ícones em PNG (`192`, `512`, `maskable`) e SVG, mais `apple-touch-icon`.
- O service worker não faz *background sync* nem fila de mutações: sem rede, a
  aplicação abre mas as ações falham com mensagem de erro.

---

## 7. Container e cabeçalhos

`web/Dockerfile`:

1. `node:24-alpine` roda `npm ci` e `npm run build`.
2. `nginxinc/nginx-unprivileged:1.29-alpine` serve `dist` na porta **8080** como
   usuário não-root.

`web/nginx.conf`:

- Fallback do SPA (`try_files ... /index.html`), já que as rotas vivem no hash.
- Proxy de `/api/`, `/health` e `/ready` para `vivabem:3000`.
- `sw.js` e `manifest.webmanifest` sem cache; assets com hash por 1 ano.
- CSP `default-src 'self'` com `style-src 'unsafe-inline'` (estilos do Svelte),
  `img-src` liberando `https:` para avatares e `worker-src 'self'`.
- `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, COOP e `X-Permitted-Cross-Domain-Policies`.
- `location = /healthz` para o healthcheck do container.

No Compose, o serviço `web` depende de a API estar saudável e publica
`${WEB_PORT:-8080}:8080`. A API precisa de `APP_ORIGIN` igual à origem pública do
frontend e, em HTTP local, `COOKIE_SECURE=false`.

---

## 8. Validação

- `npm run check` precisa ficar em **0 erros e 0 warnings**.
- `npm run build` precisa gerar `sw.js` e o manifest.
- Fluxo manual mínimo: registro → conta → categoria → transação →
  transferência → resumo no painel → preferências/tema → sessões → logout.
- Testes automatizados de UI ainda não fazem parte do CI; a validação de
  navegador é feita com Playwright/Chromium fora do repositório. O CI executa
  `npm ci`, `npm run check` e `npm run build`.

---

## 9. Limitações conhecidas

- Hash routing por simplicidade de hospedagem estática; URLs não são
  renderizadas no servidor nem indexáveis.
- Sem cache offline de dados, fila de mutações ou sincronização em segundo plano.
- Lista de transações usa paginação por `limit`/`offset`, sem virtualização.
- Ainda não há telas para hábitos, investimentos e conquistas; as rotas existem
  com placeholder.
- Sem testes de unidade de componentes (apenas typecheck e build no CI).
