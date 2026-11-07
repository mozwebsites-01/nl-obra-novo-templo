# Obra do Novo Templo — Nataniel Litsure Ministries

Protótipo local do sistema de transparência da Obra: os membros declaram as suas
contribuições, a tesouraria confirma-as e só os valores confirmados contam para a meta.

## Endereço público

https://mozwebsites-01.github.io/nl-obra-novo-templo/

Cada pessoa tem os seus próprios dados de demonstração (guardados no navegador),
por isso o que um membro declara num telemóvel não aparece na tesouraria noutro aparelho.

## Abrir localmente

```bash
npm start
```

Depois abra http://localhost:4173. Não há dependências para instalar (Node 18+).

## Contas de demonstração

| Perfil      | Telemóvel     | PIN  |
|-------------|---------------|------|
| Membro      | 84 123 4567   | 1234 |
| Tesouraria  | 84 000 0001   | 2580 |

Pedidos de acesso de exemplo (aguardam aprovação): Lídia Nhantumbo (84 771 2093)
e Osvaldo Macamo (82 664 0518).

## Regras

- O membro **não vê o total arrecadado nem a meta**: vê as suas contribuições e o
  gráfico mensal da obra, sem montantes.
- Quem se regista fica **pendente** até a tesouraria aprovar (Membros › Pedidos de acesso).
  A tesouraria é avisada no sino. Emails reais exigem servidor (próximo passo: Supabase).
- A tesouraria pode **suspender e reativar** membros; um membro suspenso não entra.
- O membro pode pôr **foto de perfil** e **escrever à tesouraria** (Mensagens).

- O membro indica **quem enviou** o dinheiro (nome ou número); a referência é opcional.

## Instalar no telemóvel (Android e iPhone)

A app é uma PWA (`manifest.webmanifest`, `sw.js`, ícones em `assets/icons/`).
O guia "Instalar no telemóvel" está na entrada, no Início e na Conta do membro,
e na barra lateral da tesouraria. No Android aparece o botão **Instalar agora**;
no iPhone, os passos **Partilhar › Adicionar ao ecrã principal**.

A instalação só funciona em **HTTPS** (ou `localhost`). Para testar em telemóveis
reais é preciso publicar o protótipo num endereço com HTTPS (por exemplo Vercel ou Netlify).

Os dados ficam no `localStorage` do navegador. "Repor demonstração" (barra lateral
do admin ou Perfil do membro) volta aos dados iniciais.

## Estrutura

- `assets/brand/` — logótipos originais recortados ao contorno (sem alterações ao desenho)
- `styles/tokens.css` — paleta e tipografia derivadas do logótipo
- `src/store.js` — camada de dados (assíncrona; trocar por Supabase sem mexer nas vistas)
- `src/seed.js` — dados de demonstração
- `src/views/` — entrada, membro (telemóvel) e administração (desktop)

## Ainda não incluído

- Autenticação real (o PIN está em texto simples no navegador — apenas para demonstração)
- Base de dados partilhada entre dispositivos (próximo passo: Supabase)
- Registo de despesas e etapas da obra (fora do âmbito escolhido para esta versão)

## Publicação automática (GitHub → servidor DirectAdmin)

1. Cada commit na `main` é enviado sozinho para o GitHub (hook `scripts/git-hooks/post-commit`;
   ativado com `git config core.hooksPath scripts/git-hooks`).
2. A GitHub Action `.github/workflows/deploy.yml` envia os ficheiros por SSH (rsync) para a
   pasta pública do DirectAdmin. Não apaga nada que já exista no servidor.
3. Ficam de fora do servidor os ficheiros listados em `.deployignore`.
4. O `.htaccess` força HTTPS (necessário para instalar a app) e evita cache do service worker.

Segredos necessários no repositório (Settings › Secrets and variables › Actions):
`SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PATH`, `SSH_PRIVATE_KEY` (opcional: `SSH_KNOWN_HOSTS`).
Para publicar manualmente: separador Actions › "Publicar no servidor" › Run workflow.
