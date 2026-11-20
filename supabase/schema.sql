-- =====================================================================
-- Nataniel Litsure Ministries · Obra do Novo Templo
-- Base de dados partilhada (Supabase). Colar no SQL Editor e executar uma vez.
--
-- Quem é quem:
--   admin   – a administração (principal): vê e gere tudo
--   gestor  – recebe e regista contribuições; vê apenas as suas
--   membro  – quem contribui (não entra no sistema)
-- As regras de acesso (RLS) garantem isto no servidor, não só no ecrã.
-- =====================================================================

create extension if not exists pgcrypto;

-- Definições da obra (uma única linha) ------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  obra_nome text not null default 'Obra do Novo Templo',
  meta numeric(14,2) not null default 5000000,
  inicio date not null default date_trunc('month', now())::date,
  prazo date not null default (date_trunc('year', now()) + interval '2 years' - interval '1 day')::date,
  -- Número oficial do WhatsApp da tesouraria (envia os comprovativos)
  whatsapp text not null default '879470600' check (whatsapp ~ '^8[2-7][0-9]{7}$')
);
alter table public.settings add column if not exists whatsapp text not null default '879470600';
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Pessoas: administração, gestores e membros --------------------------------
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  nome text not null check (char_length(nome) between 3 and 80),
  telefone text not null unique check (telefone ~ '^8[2-7][0-9]{7}$'),
  role text not null check (role in ('admin', 'gestor', 'membro')),
  cargo text,
  estado text not null default 'ativo' check (estado in ('ativo', 'suspenso')),
  criado_em timestamptz not null default now(),
  criado_por uuid references public.people (id)
);
create unique index if not exists one_admin on public.people ((true)) where role = 'admin';

-- Contribuições recebidas ---------------------------------------------------
create sequence if not exists public.receipt_seq;

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  membro_id uuid not null references public.people (id),
  valor numeric(14,2) not null check (valor > 0 and valor <= 10000000),
  metodo text not null check (metodo in ('mpesa', 'emola', 'banco', 'numerario')),
  referencia text not null default '',
  pagador text not null default '',
  data date not null,
  nota text not null default '',
  registado_por uuid not null references public.people (id),
  registado_em timestamptz not null default now(),
  notificado_em timestamptz,
  notificado_por uuid references public.people (id),
  notificado_canal text
);
alter table public.contributions add column if not exists envio_estado text;
alter table public.contributions add column if not exists envio_erro text;
alter table public.contributions add column if not exists envio_em timestamptz;
alter table public.contributions add column if not exists envio_tentativas int not null default 0;
alter table public.contributions add column if not exists whatsapp_msg_id text;
create index if not exists contributions_registado_por on public.contributions (registado_por);
create index if not exists contributions_data on public.contributions (data desc);

-- Número do recibo: NL-AAAA-000001, gerado no servidor (sem repetições)
create or replace function public.set_receipt_ref() returns trigger
language plpgsql as $$
begin
  if new.data > (now() at time zone 'Africa/Maputo')::date then raise exception 'A data do recebimento não pode ser futura.'; end if;
  new.ref := 'NL-' || to_char(now() at time zone 'Africa/Maputo', 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0');
  new.registado_em := now();
  -- O envio começa sempre por fazer (só o servidor o marca como enviado)
  new.envio_estado := null; new.envio_erro := null; new.envio_em := null; new.envio_tentativas := 0; new.whatsapp_msg_id := null;
  return new;
end $$;
drop trigger if exists contributions_ref on public.contributions;
create trigger contributions_ref before insert on public.contributions
  for each row execute function public.set_receipt_ref();

-- Funções de apoio às regras -----------------------------------------------
create or replace function public.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() and estado = 'ativo' and role in ('admin', 'gestor')
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.people where user_id = auth.uid() and estado = 'ativo' and role in ('admin', 'gestor')
$$;

-- Ecrã de entrada (antes de entrar): só diz se o número tem acesso, nunca o nome
create or replace function public.phone_status(p_telefone text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('role', role, 'estado', estado) from public.people where telefone = p_telefone
$$;

create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.people where role = 'admin')
$$;

-- Primeiro acesso: a primeira conta criada fica como administração (só se ainda não existir)
create or replace function public.setup_admin(p_nome text, p_telefone text) returns public.people
language plpgsql security definer set search_path = public as $$
declare r public.people;
begin
  if auth.uid() is null then raise exception 'Sessão em falta.'; end if;
  if exists (select 1 from public.people where role = 'admin') then raise exception 'A conta da administração já foi criada.'; end if;
  insert into public.people (user_id, nome, telefone, role, cargo) values (auth.uid(), p_nome, p_telefone, 'admin', 'Administração') returning * into r;
  return r;
end $$;

-- A administração cria um gestor (a conta de acesso é criada antes, no navegador)
create or replace function public.add_gestor(p_user uuid, p_nome text, p_telefone text) returns public.people
language plpgsql security definer set search_path = public as $$
declare r public.people;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'Só a administração pode adicionar gestores.'; end if;
  insert into public.people (user_id, nome, telefone, role, cargo, criado_por)
    values (p_user, p_nome, p_telefone, 'gestor', 'Gestor', public.my_person_id()) returning * into r;
  return r;
end $$;

-- Regras de acesso (RLS) ----------------------------------------------------
alter table public.settings enable row level security;
alter table public.people enable row level security;
alter table public.contributions enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (public.my_role() is not null);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (public.my_role() is not null);
drop policy if exists people_add_member on public.people;
create policy people_add_member on public.people for insert to authenticated
  with check (public.my_role() is not null and role = 'membro' and user_id is null);
drop policy if exists people_admin_update on public.people;
create policy people_admin_update on public.people for update to authenticated
  using (public.my_role() = 'admin' and role <> 'admin') with check (public.my_role() = 'admin' and role <> 'admin');

drop policy if exists contributions_read on public.contributions;
create policy contributions_read on public.contributions for select to authenticated
  using (public.my_role() = 'admin' or registado_por = public.my_person_id());
drop policy if exists contributions_insert on public.contributions;
create policy contributions_insert on public.contributions for insert to authenticated
  with check (public.my_role() is not null and registado_por = public.my_person_id());
drop policy if exists contributions_notify on public.contributions;
create policy contributions_notify on public.contributions for update to authenticated
  using (public.my_role() = 'admin' or registado_por = public.my_person_id())
  with check (public.my_role() = 'admin' or registado_por = public.my_person_id());

-- Os valores recebidos não se alteram depois de registados: só os campos do envio ao membro
create or replace function public.lock_contribution() returns trigger
language plpgsql as $$
begin
  if (new.membro_id, new.valor, new.metodo, new.referencia, new.pagador, new.data, new.nota, new.registado_por, new.ref, new.registado_em)
     is distinct from (old.membro_id, old.valor, old.metodo, old.referencia, old.pagador, old.data, old.nota, old.registado_por, old.ref, old.registado_em)
  then raise exception 'Um recebimento registado não pode ser alterado.'; end if;
  return new;
end $$;
drop trigger if exists contributions_lock on public.contributions;
create trigger contributions_lock before update on public.contributions
  for each row execute function public.lock_contribution();

-- Permissões de execução
revoke all on function public.setup_admin(text, text) from public;
revoke all on function public.add_gestor(uuid, text, text) from public;
grant execute on function public.phone_status(text) to anon, authenticated;
grant execute on function public.needs_setup() to anon, authenticated;
grant execute on function public.setup_admin(text, text) to authenticated;
grant execute on function public.add_gestor(uuid, text, text) to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_person_id() to authenticated;

-- =====================================================================
-- Envio automático do comprovativo pelo WhatsApp (API oficial da Meta)
-- Estados: a_enviar → enviado → entregue → lido   ·   falhou (com o motivo)
-- Só o servidor (funções send-receipt e whatsapp-webhook) altera estes campos.
-- =====================================================================
alter table public.contributions drop constraint if exists contributions_envio_estado_check;
alter table public.contributions add constraint contributions_envio_estado_check
  check (envio_estado in ('a_enviar', 'enviado', 'entregue', 'lido', 'falhou'));
alter table public.contributions add column if not exists envio_erro text;
alter table public.contributions add column if not exists envio_em timestamptz;
alter table public.contributions add column if not exists envio_tentativas int not null default 0;
alter table public.contributions add column if not exists whatsapp_msg_id text;
create index if not exists contributions_whatsapp_msg on public.contributions (whatsapp_msg_id);

-- O navegador não pode marcar um envio como feito: só o servidor (service_role)
create or replace function public.lock_envio() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (new.envio_estado, new.envio_erro, new.envio_em, new.envio_tentativas, new.whatsapp_msg_id)
         is distinct from (old.envio_estado, old.envio_erro, old.envio_em, old.envio_tentativas, old.whatsapp_msg_id)
  then raise exception 'O estado do envio só é atualizado pelo servidor.'; end if;
  return new;
end $$;
drop trigger if exists contributions_lock_envio on public.contributions;
create trigger contributions_lock_envio before update on public.contributions
  for each row execute function public.lock_envio();

-- Acesso pela API: só utilizadores com sessão; os visitantes (anon) só usam as funções públicas.
-- As regras RLS acima decidem o que cada um vê.
grant usage on schema public to anon, authenticated;
revoke all on public.settings, public.people, public.contributions from anon;
grant select, update on public.settings to authenticated;
grant select, insert, update on public.people to authenticated;
grant select, insert, update on public.contributions to authenticated;
grant usage, select on sequence public.receipt_seq to authenticated;
grant all on public.settings, public.people, public.contributions to service_role;
grant usage, select on sequence public.receipt_seq to service_role;

-- =====================================================================
-- Despesas: saídas de dinheiro da obra (só a administração regista e vê)
-- Uma despesa registada nunca se altera nem se apaga. Se houver um engano, a
-- administração ANULA a despesa (com o motivo) e ela fica no histórico, fora dos totais.
-- Esta secção só acrescenta: não mexe nas tabelas nem nos dados existentes.
-- =====================================================================
create sequence if not exists public.expense_seq;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  data date not null,
  valor numeric(14,2) not null check (valor > 0 and valor <= 100000000),
  categoria text not null check (categoria in ('materiais', 'mao_obra', 'transporte', 'equipamento', 'licencas', 'servicos', 'outros')),
  descricao text not null check (char_length(descricao) between 3 and 120),
  -- Nota obrigatória: para que foi o dinheiro e porquê (aparece nos relatórios)
  nota text not null check (char_length(nota) between 10 and 500),
  beneficiario text not null default '',
  metodo text not null check (metodo in ('mpesa', 'emola', 'banco', 'numerario')),
  referencia text not null default '',
  registado_por uuid not null references public.people (id),
  registado_em timestamptz not null default now(),
  anulada_em timestamptz,
  anulada_por uuid references public.people (id),
  motivo_anulacao text
);
create index if not exists expenses_data on public.expenses (data desc);

-- Número da despesa: DS-AAAA-000001, gerado no servidor
create or replace function public.set_expense_ref() returns trigger
language plpgsql as $$
begin
  if new.data > (now() at time zone 'Africa/Maputo')::date then raise exception 'A data da despesa não pode ser futura.'; end if;
  new.ref := 'DS-' || to_char(now() at time zone 'Africa/Maputo', 'YYYY') || '-' || lpad(nextval('public.expense_seq')::text, 6, '0');
  new.registado_em := now();
  new.anulada_em := null; new.anulada_por := null; new.motivo_anulacao := null;
  return new;
end $$;
drop trigger if exists expenses_ref on public.expenses;
create trigger expenses_ref before insert on public.expenses
  for each row execute function public.set_expense_ref();

-- Só é possível anular (uma vez, com motivo). Nenhum outro campo muda.
create or replace function public.lock_expense() returns trigger
language plpgsql as $$
begin
  if (new.ref, new.data, new.valor, new.categoria, new.descricao, new.nota, new.beneficiario, new.metodo, new.referencia, new.registado_por, new.registado_em)
     is distinct from (old.ref, old.data, old.valor, old.categoria, old.descricao, old.nota, old.beneficiario, old.metodo, old.referencia, old.registado_por, old.registado_em)
  then raise exception 'Uma despesa registada não pode ser alterada. Anule-a e registe-a de novo.'; end if;
  if old.anulada_em is not null then raise exception 'Esta despesa já foi anulada.'; end if;
  if new.anulada_por is null or char_length(trim(coalesce(new.motivo_anulacao, ''))) < 3 then raise exception 'Indique o motivo da anulação.'; end if;
  new.anulada_em := now();
  return new;
end $$;
drop trigger if exists expenses_lock on public.expenses;
create trigger expenses_lock before update on public.expenses
  for each row execute function public.lock_expense();

-- Nunca se apagam despesas (nem por engano)
create or replace function public.no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Os registos financeiros não podem ser apagados.';
end $$;
drop trigger if exists expenses_no_delete on public.expenses;
create trigger expenses_no_delete before delete on public.expenses
  for each row execute function public.no_delete();

alter table public.expenses enable row level security;
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to authenticated using (public.my_role() = 'admin');
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.my_role() = 'admin' and registado_por = public.my_person_id());
drop policy if exists expenses_void on public.expenses;
create policy expenses_void on public.expenses for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin' and anulada_por = public.my_person_id());

revoke all on public.expenses from anon;
grant select, insert, update on public.expenses to authenticated;
grant usage, select on sequence public.expense_seq to authenticated;
grant all on public.expenses to service_role;
grant usage, select on sequence public.expense_seq to service_role;
