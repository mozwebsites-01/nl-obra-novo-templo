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

-- =====================================================================
-- Acesso de desenvolvedor (super admin): acesso total, para manutenção.
-- Uma única conta, para um número reservado em dev_config (o número NÃO fica
-- neste ficheiro: é gravado diretamente no servidor). A conta é criada pelo
-- próprio desenvolvedor no ecrã de entrada, com o PIN que ele escolher.
-- Esta secção só acrescenta: não altera nem apaga dados.
-- =====================================================================
alter table public.people drop constraint if exists people_role_check;
alter table public.people add constraint people_role_check check (role in ('admin', 'gestor', 'membro', 'super'));
create unique index if not exists one_super on public.people ((true)) where role = 'super';

create table if not exists public.dev_config (
  id int primary key default 1 check (id = 1),
  super_phone text check (super_phone ~ '^8[2-7][0-9]{7}$')
);
alter table public.dev_config enable row level security; -- sem regras: ninguém a lê pela API
revoke all on public.dev_config from anon, authenticated;

-- O desenvolvedor conta como administração em todas as regras de acesso
create or replace function public.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() and estado = 'ativo' and role in ('admin', 'gestor', 'super')
$$;
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when role = 'super' then 'admin' else role end
  from public.people where user_id = auth.uid() and estado = 'ativo' and role in ('admin', 'gestor', 'super')
$$;

-- A administração não altera a conta de desenvolvedor (nem a sua própria)
drop policy if exists people_admin_update on public.people;
create policy people_admin_update on public.people for update to authenticated
  using (public.my_role() = 'admin' and role not in ('admin', 'super')) with check (public.my_role() = 'admin' and role not in ('admin', 'super'));

-- Ecrã de entrada: este número pode criar o acesso de desenvolvedor? (só enquanto não existir)
create or replace function public.dev_setup_available(p_telefone text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dev_config where super_phone = p_telefone)
     and not exists (select 1 from public.people where role = 'super')
$$;

-- Cria a conta de desenvolvedor: só para a conta de acesso do número reservado, uma única vez
create or replace function public.setup_super(p_nome text) returns public.people
language plpgsql security definer set search_path = public as $$
declare v_tel text; v_email text; r public.people;
begin
  if auth.uid() is null then raise exception 'Sessão em falta.'; end if;
  select super_phone into v_tel from public.dev_config where id = 1;
  if v_tel is null then raise exception 'Acesso de desenvolvedor não configurado.'; end if;
  if exists (select 1 from public.people where role = 'super') then raise exception 'O acesso de desenvolvedor já foi criado.'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is distinct from v_tel || '@nl-obra.app' then raise exception 'Número não autorizado.'; end if;
  insert into public.people (user_id, nome, telefone, role, cargo) values (auth.uid(), p_nome, v_tel, 'super', 'Desenvolvedor') returning * into r;
  return r;
end $$;

revoke all on function public.setup_super(text) from public;
grant execute on function public.dev_setup_available(text) to anon, authenticated;
grant execute on function public.setup_super(text) to authenticated;

-- =====================================================================
-- SEGURANÇA MÁXIMA (só acrescenta; não altera nem apaga dados)
--  1. Esquema "secure", invisível à API: chave secreta, tentativas de entrada,
--     histórico de alterações e cópias diárias.
--  2. Histórico (auditoria) de TODAS as alterações; não pode ser alterado nem apagado.
--  3. Nada se apaga: pessoas, recebimentos, despesas e definições.
--  4. Dados da conta (telemóvel, papel) não se alteram pelo navegador.
--  5. Cópia automática de todos os dados todos os dias (guardadas 120 dias).
--  6. Funções só para o servidor (entrada segura com bloqueio por tentativas).
-- =====================================================================
create schema if not exists secure;
revoke all on schema secure from public, anon, authenticated;

-- Chave secreta gerada no próprio servidor (ninguém a vê; só a função de entrada a usa)
create table if not exists secure.pepper (
  id int primary key default 1 check (id = 1),
  value text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into secure.pepper (id) values (1) on conflict (id) do nothing;

-- Tentativas de entrada por número: bloqueio crescente (15 min, 30 min, 1 h … até 24 h)
create table if not exists secure.login_attempts (
  telefone text primary key,
  fails int not null default 0,
  locked_until timestamptz,
  last_at timestamptz not null default now()
);
create table if not exists secure.auth_log (
  id bigserial primary key, at timestamptz not null default now(),
  telefone text, ok boolean not null, acao text, ip text
);

-- Histórico de alterações (quem, quando, o quê: antes e depois)
create table if not exists secure.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid, actor_role text,
  table_name text not null, op text not null, row_id text,
  old_row jsonb, new_row jsonb
);
create or replace function secure.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into secure.audit_log (actor, actor_role, table_name, op, row_id, old_row, new_row)
  values (auth.uid(), coalesce(auth.role(), current_user), tg_table_name, tg_op,
          case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create or replace function secure.readonly() returns trigger
language plpgsql as $$
begin
  raise exception 'O histórico de segurança não pode ser alterado nem apagado.';
end $$;
drop trigger if exists audit_log_readonly on secure.audit_log;
create trigger audit_log_readonly before update or delete on secure.audit_log
  for each row execute function secure.readonly();

do $$
declare t text;
begin
  foreach t in array array['people', 'contributions', 'expenses', 'settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function secure.audit()', t || '_audit', t);
  end loop;
  -- Nada se apaga (as despesas já estavam protegidas)
  foreach t in array array['people', 'contributions', 'settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.no_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- Dados da conta que o navegador nunca pode mudar (só o servidor)
create or replace function public.lock_person() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then return new; end if;
  if (new.id, new.user_id, new.telefone, new.role, new.criado_em, new.criado_por)
     is distinct from (old.id, old.user_id, old.telefone, old.role, old.criado_em, old.criado_por)
  then raise exception 'Estes dados da conta não podem ser alterados.'; end if;
  return new;
end $$;
drop trigger if exists people_lock on public.people;
create trigger people_lock before update on public.people
  for each row execute function public.lock_person();

-- Cópia diária de todos os dados
create table if not exists secure.snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create or replace function secure.take_snapshot() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into secure.snapshots (data) select jsonb_build_object(
    'settings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.settings x),
    'people', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.people x),
    'contributions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.contributions x),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.expenses x));
  delete from secure.snapshots where taken_at < now() - interval '120 days';
end $$;
create extension if not exists pg_cron;
select cron.schedule('nl-copia-diaria', '0 0 * * *', 'select secure.take_snapshot()');

-- Funções usadas só pela função de entrada no servidor (service_role) -------
create or replace function public.sec_pepper() returns text
language sql stable security definer set search_path = secure as $$ select value from secure.pepper where id = 1 $$;

create or replace function public.sec_lock_status(p_telefone text) returns int
language sql stable security definer set search_path = secure as $$
  select coalesce(greatest(0, ceil(extract(epoch from (locked_until - now()))))::int, 0)
  from (select max(locked_until) as locked_until from secure.login_attempts where telefone = p_telefone) x
$$;

create or replace function public.sec_register(p_telefone text, p_ok boolean, p_acao text default 'entrada', p_ip text default null) returns json
language plpgsql security definer set search_path = secure as $$
declare r secure.login_attempts; mins int;
begin
  insert into secure.auth_log (telefone, ok, acao, ip) values (p_telefone, p_ok, p_acao, p_ip);
  if p_ok then
    delete from secure.login_attempts where telefone = p_telefone;
    return json_build_object('ok', true);
  end if;
  insert into secure.login_attempts (telefone, fails, last_at) values (p_telefone, 1, now())
    on conflict (telefone) do update set fails = secure.login_attempts.fails + 1, last_at = now()
    returning * into r;
  if r.fails % 5 = 0 then
    mins := least(15 * power(2, r.fails / 5 - 1)::int, 1440);
    update secure.login_attempts set locked_until = now() + make_interval(mins => mins) where telefone = p_telefone;
    return json_build_object('locked', mins * 60);
  end if;
  return json_build_object('left', 5 - r.fails % 5);
end $$;

revoke all on function public.sec_pepper() from public, anon, authenticated;
revoke all on function public.sec_lock_status(text) from public, anon, authenticated;
revoke all on function public.sec_register(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.sec_pepper() to service_role;
grant execute on function public.sec_lock_status(text) to service_role;
grant execute on function public.sec_register(text, boolean, text, text) to service_role;
