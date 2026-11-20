# Envio automático do recibo pelo WhatsApp

Quando o gestor regista uma contribuição, o membro recebe **automaticamente** no WhatsApp a
confirmação com o **recibo em PDF anexado**, enviada pelo número oficial da tesouraria
**+258 87 947 0600**. Ninguém precisa de carregar em "Enviar".

```
Gestor regista  →  sistema gera o PDF  →  função send-receipt (Supabase)
                →  API oficial do WhatsApp (Meta)  →  membro recebe mensagem + PDF
Meta avisa (webhook)  →  função whatsapp-webhook  →  recibo marcado "Entregue" / "Lido"
```

No sistema, cada recibo mostra o estado: **A enviar → Enviado → Entregue → Lido**, ou
**Não enviado** com o motivo e o botão **Tentar de novo**.

---

## 1. Número 87 947 0600 na API oficial (Meta)

> O número usado na API deixa de funcionar na aplicação WhatsApp normal do telemóvel
> (a não ser que se use a "coexistência" do WhatsApp Business App, quando disponível).
> Se o número já tem conversas importantes, faça uma cópia antes.

1. Em **business.facebook.com**, criar (ou usar) o **Meta Business Portfolio** da igreja e
   iniciar a **verificação da empresa** (documento de registo da igreja).
2. Em **developers.facebook.com › My Apps › Create App**, escolher **Business**, e adicionar o
   produto **WhatsApp**.
3. Em **WhatsApp › API Setup › Add phone number**, adicionar **+258 87 947 0600**, com o nome de
   apresentação **Nataniel Litsure Ministries**, e confirmar com o código por SMS ou chamada.
4. Copiar o **Phone number ID** (não é o número de telefone).
5. Em **Business Settings › Users › System users**, criar um utilizador de sistema (Admin),
   dar-lhe acesso à app e ao número, e **gerar um token permanente** com as permissões
   `whatsapp_business_messaging` e `whatsapp_business_management`. Guardar o token em segurança.
6. Em **App Settings › Basic**, copiar o **App Secret**.
7. Adicionar um método de pagamento na conta WhatsApp (as conversas de utilidade têm um
   pequeno custo por mensagem, cobrado pela Meta).

## 2. Modelo de mensagem (aprovação da Meta)

Em **WhatsApp Manager › Message templates › Create template**:

- **Categoria:** Utility
- **Nome:** `recibo_contribuicao`
- **Idioma:** Portuguese (POR) — código `pt_PT`
- **Cabeçalho:** Document (o recibo em PDF)
- **Corpo:**

```
Olá {{1}}, confirmamos a receção da sua contribuição de {{2}} para a {{3}}.

Data e forma de pagamento: {{4}}
Recibo n.º {{5}} (em anexo)

Que Deus abençoe a sua generosidade.
```

- **Rodapé:** `Nataniel Litsure Ministries · Tesouraria`
- Exemplos para a revisão: `Abel` · `2 500,00 MT` · `Obra do Novo Templo` ·
  `13 nov 2026 · M-Pesa` · `NL-2026-000001`

A aprovação demora normalmente de alguns minutos a 24 horas.

## 3. Supabase: funções e segredos

1. Executar `supabase/schema.sql` no **SQL Editor** (já inclui os campos do envio).
2. Em **Edge Functions › Deploy a new function › Via Editor**:
   - **send-receipt**: colar `supabase/functions/send-receipt/index.ts` (com "Verify JWT" ligado).
   - **whatsapp-webhook**: colar `supabase/functions/whatsapp-webhook/index.ts`
     (com **"Verify JWT" desligado**).
3. Em **Edge Functions › Secrets**, adicionar:

| Segredo | Valor |
|---|---|
| `WA_TOKEN` | o token permanente do passo 1.5 |
| `WA_PHONE_NUMBER_ID` | o Phone number ID do passo 1.4 |
| `WA_TEMPLATE` | `recibo_contribuicao` |
| `WA_TEMPLATE_LANG` | `pt_PT` |
| `WA_VERIFY_TOKEN` | uma palavra secreta à escolha (ex.: `nl-obra-2026-...`) |
| `WA_APP_SECRET` | o App Secret do passo 1.6 |

## 4. Webhook (estados Entregue / Lido)

Na Meta, em **WhatsApp › Configuration › Webhook › Edit**:

- **Callback URL:** `https://<projeto>.supabase.co/functions/v1/whatsapp-webhook`
- **Verify token:** o mesmo valor de `WA_VERIFY_TOKEN`
- Em **Webhook fields**, subscrever **messages**.

## 5. Teste

1. Entrar como gestor, registar uma contribuição para um membro com o seu próprio número.
2. O recibo mostra "A enviar…" e depois **"Comprovativo enviado por WhatsApp"**.
3. No telemóvel do membro chega a mensagem do **+258 87 947 0600** com o PDF.
4. Ao abrir a mensagem, o recibo passa a **"Lido"** no sistema.

Se aparecer **"Não enviado"**, o motivo está escrito por baixo (por exemplo, modelo ainda
não aprovado, token expirado ou número sem WhatsApp).
