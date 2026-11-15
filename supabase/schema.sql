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
  prazo date not null default (date_trunc('year', now()) + interval '2 years' - interval '1 day')::date
);
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
create index if not exists contributions_registado_por on public.contributions (registado_por);
create index if not exists contributions_data on public.contributions (data desc);

-- Número do recibo: NL-AAAA-000001, gerado no servidor (sem repetições)
create or replace function public.set_receipt_ref() returns trigger
language plpgsql as $$
begin
  if new.data > (now() at time zone 'Africa/Maputo')::date then raise exception 'A data do recebimento não pode ser futura.'; end if;
  new.ref := 'NL-' || to_char(now() at time zone 'Africa/Maputo', 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0');
  new.registado_em := now();
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
