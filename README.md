# Obra do Novo Templo — Nataniel Litsure Ministries

Protótipo do sistema de registo da Obra: os gestores recebem as contribuições,
registam-nas e emitem o recibo; a administração acompanha o total de cada gestor e o total geral.

## Endereço público

https://mozwebsites-01.github.io/nl-obra-novo-templo/

Cada pessoa tem os seus próprios dados de demonstração (guardados no navegador),
por isso o que um gestor regista num telemóvel ainda não aparece à administração noutro aparelho.

## Abrir localmente

```bash
npm start
```

Depois abra http://localhost:4173. Não há dependências para instalar (Node 18+).

## Contas de demonstração

| Perfil                    | Nome          | Telemóvel   | PIN  |
|---------------------------|---------------|-------------|------|
| Administração (principal) | Samuel Tembe  | 84 000 0001 | 2580 |
| Gestora                   | Rute Langa    | 84 000 0002 | 1357 |
| Gestor                    | Paulo Cossa   | 84 000 0003 | 2468 |

## Regras

- **Painel do membro em pausa**: os membros não entram no sistema; quem tentar vê
  "Área do membro em pausa". O código continua em `src/views/member.js` para voltar a ativar.
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
