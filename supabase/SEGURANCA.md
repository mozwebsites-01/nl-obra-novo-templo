# Segurança do sistema NL Obra

## O que protege o sistema

| Ameaça | Proteção |
|---|---|
| Adivinhar o PIN | A entrada passa só pela função `auth` no servidor. Ao fim de 5 PIN errados o número fica bloqueado 15 min, depois 30 min, 1 h … até 24 h. O bloqueio é no servidor e não se contorna. |
| Tentar o PIN diretamente no servidor de autenticação | A palavra-passe real de cada conta é `HMAC(chave secreta, telemóvel:PIN)`. A chave é gerada na base de dados (`secure.pepper`) e nunca sai do servidor, por isso não há como a calcular de fora. |
| Criar contas falsas | As contas só são criadas pela função `auth` (administração, gestores, desenvolvedor). |
| Ver ou mexer em dados sem permissão | Regras de acesso (RLS) em todas as tabelas: gestores só veem os seus recebimentos; despesas só a administração. |
| Apagar dados | Pessoas, recebimentos, despesas e definições **não se apagam** (bloqueio na base de dados). Despesas erradas anulam-se com motivo. |
| Alterar valores já registados | Recebimentos e despesas não se alteram depois de gravados. Telemóvel e papel de cada conta só mudam no servidor. |
| Perder dados | Cópia automática de tudo, todos os dias às 02:00 (Maputo), guardada 120 dias em `secure.snapshots`. A administração também pode baixar uma cópia em **Obra › Cópia de segurança**. |
| Descobrir quem fez o quê | Histórico de todas as alterações em `secure.audit_log` (quem, quando, antes e depois). Não pode ser alterado nem apagado. Entradas e PIN errados em `secure.auth_log`. |
| Código malicioso no navegador / páginas falsas | Política de conteúdo (CSP) que só deixa correr o código do site, proibição de abrir o site dentro de outra página, HTTPS obrigatório. |

## Recuperar dados de uma cópia diária (SQL Editor do Supabase)

Ver as cópias:

```sql
select id, taken_at,
       jsonb_array_length(data->'people') as pessoas,
       jsonb_array_length(data->'contributions') as recebimentos,
       jsonb_array_length(data->'expenses') as despesas
from secure.snapshots order by id desc limit 10;
```

Ver um registo de uma cópia (por exemplo, um recebimento):

```sql
select r from secure.snapshots s, jsonb_array_elements(s.data->'contributions') r
where s.id = 123 and r->>'ref' = 'NL-2026-000001';
```

Ver o histórico de alterações recentes:

```sql
select at, actor_role, table_name, op, row_id from secure.audit_log order by id desc limit 50;
```

## Regra para alterações futuras

A base de dados só recebe alterações que **acrescentam** (novas tabelas, colunas ou regras).
Nunca se apagam tabelas, colunas ou dados existentes.
