# Obra do Novo Templo — Nataniel Litsure Ministries

Protótipo do sistema de registo da Obra: os gestores recebem as contribuições,
registam-nas e emitem o recibo; a administração acompanha o total de cada gestor e o total geral.

## Endereço público

https://mozwebsites-01.github.io/nl-obra-novo-templo/

## Primeiro acesso

O sistema começa vazio. Na primeira visita aparece **Configuração inicial**: cria-se a conta
da administração (nome, telemóvel e PIN de 4 dígitos). Depois, em **Gestores › Adicionar
gestor**, a administração cria cada gestor; o sistema gera o PIN, que deve ser entregue em privado.

**Importante:** os dados ficam guardados no navegador do aparelho onde são registados. Enquanto
não houver base de dados partilhada (próximo passo: Supabase), use sempre o mesmo aparelho
para a administração e os gestores; noutro telemóvel o sistema aparece vazio.

## Base de dados partilhada (Supabase)

1. Criar um projeto em supabase.com e, em Authentication › Providers › Email, desativar
   "Confirm email".
2. No SQL Editor, colar e executar `supabase/schema.sql` (tabelas, número de recibo
   automático e regras de acesso: cada gestor só vê os seus recebimentos; a administração vê tudo).
3. Em `src/config.js`, preencher `url` e `anonKey` (Project Settings › API). Nunca usar a chave
   `service_role` no site.

Sem configuração, o sistema guarda os dados só no navegador (`src/store-local.js`).

### Envio automático do recibo pelo WhatsApp

Com o Supabase ligado, cada contribuição registada é enviada automaticamente ao membro pelo
WhatsApp oficial da tesouraria (+258 87 947 0600), com o recibo em PDF anexado. Passo a passo
(Meta, modelo de mensagem, funções e webhook): [supabase/WHATSAPP.md](supabase/WHATSAPP.md).

## Abrir localmente

```bash
npm start
```

Depois abra http://localhost:4173. Não há dependências para instalar (Node 18+).

## Regras

- **Sem painel do membro**: os membros não entram no sistema. São registados pelos gestores e
  recebem o comprovativo pelo WhatsApp (com a ligação para o recibo em PDF).
- **Administração (principal)** vê tudo: total geral da obra, saldo acumulado de cada gestor,
  todos os recebimentos e relatórios de todos (ou de um gestor). Cria, suspende e reativa
  gestores, gere membros e a meta da obra.
- **Gestores** registam membros, lançam cada valor que recebem (fica logo confirmado e gera um
  recibo de receção em PDF) e baixam relatórios diários, semanais e mensais em PDF.
  Cada gestor vê **apenas os seus recebimentos e o seu saldo acumulado**.
- Relatórios: Relatórios › Diário / Semanal / Mensal › Baixar PDF (ou Exportar CSV).
- **Comprovativo ao membro**: depois de registar (ou ao abrir qualquer recibo), o bloco
  "Enviar comprovativo" abre o WhatsApp do membro com a mensagem de confirmação já escrita e a
  ligação para o recibo; no telemóvel, "Partilhar PDF" anexa o próprio PDF. O membro abre a
  ligação (página pública `#/recibo/…`, sem entrar no sistema) e descarrega o PDF. O envio fica
  marcado como "Enviado" nos recebimentos. O PDF é gerado no navegador (jsPDF em
  `assets/vendor/`, Montserrat em `assets/fonts/`, licença OFL).
- **Entrada e saída**: a sessão fica só no separador aberto — fechar o separador ou a app,
  ou abrir o endereço noutra vez, pede sempre o PIN. O aparelho lembra apenas o número da última
  conta ("Olá, Rute" + PIN). Após 3 minutos sem atividade a sessão termina (aviso 30 s antes).
  5 PIN errados bloqueiam a entrada durante 60 s. "Sair" pede confirmação.

Os dados ficam no `localStorage` do navegador (chave `nl.db.v2`).

## Estrutura

- `assets/brand/` — logótipos originais recortados ao contorno (sem alterações ao desenho)
- `styles/tokens.css` — paleta e tipografia derivadas do logótipo
- `src/store.js` — camada de dados (assíncrona; trocar por Supabase sem mexer nas vistas)
- `src/views/` — entrada, área de gestão e página pública do recibo

## Ainda não incluído

- Autenticação real (o PIN está em texto simples no navegador — apenas para demonstração)
- Base de dados partilhada entre dispositivos (próximo passo: Supabase)
- Registo de despesas e etapas da obra (fora do âmbito escolhido para esta versão)

## Publicação automática (GitHub → servidor DirectAdmin)

Endereço: **https://nataniellitsure.tr** (servidor ValueServer, DirectAdmin, conta `addulam2026`).

1. Cada commit na `main` é enviado sozinho para o GitHub (hook `scripts/git-hooks/post-commit`).
2. No servidor, o cron corre `~/nl-obra-deploy.sh` de 5 em 5 minutos: se houver uma versão nova
   na `main`, atualiza a cópia em `~/nl-obra-src` (git) e copia os ficheiros para
   `~/domains/nataniellitsure.tr/public_html` (rsync, sem apagar nada). O registo fica em
   `~/nl-obra-deploy.log`. Cópia do script: `scripts/server/nl-obra-deploy.sh`.
3. Publicar já, sem esperar: no DirectAdmin › Terminal de comando, `~/nl-obra-deploy.sh force`.
4. Ficam de fora do servidor os ficheiros listados em `.deployignore`.
5. HTTPS: certificado Let's Encrypt automático (DirectAdmin › SSL/TLS › ACME). O `.htaccess`
   força HTTPS.

O SSH do alojamento não está acessível de fora, por isso a GitHub Action
`.github/workflows/deploy.yml` (rsync por SSH) fica desativada; o envio é feito pelo próprio servidor.
