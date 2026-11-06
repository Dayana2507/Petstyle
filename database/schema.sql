-- =====================================================================
-- PETSTYLE · BASE DE DATOS (Supabase / PostgreSQL)
--
-- CÓMO USARLO: Supabase -> SQL Editor -> New query -> pega TODO este
-- archivo -> Run.
--
-- ⚠ Este script BORRA y vuelve a crear las tablas de PetStyle
--   (profiles, mascotas, citas). Los usuarios de Authentication NO se
--   borran. Puedes ejecutarlo varias veces mientras desarrollas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Limpieza
-- ---------------------------------------------------------------------
drop table if exists public.citas cascade;
drop table if exists public.mascotas cascade;
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.es_admin() cascade;
drop function if exists public.validar_transicion_estado() cascade;
drop type if exists estado_cita cascade;
drop type if exists rol_usuario cascade;

-- ---------------------------------------------------------------------
-- 1) Tablas
-- ---------------------------------------------------------------------

-- Un perfil por cada usuario de Authentication. El ROL vive aquí.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null default '',
  telefono    text not null default '',
  rol         text not null default 'CLIENTE' check (rol in ('CLIENTE', 'ADMINISTRADOR')),
  created_at  timestamptz not null default now()
);

create table public.mascotas (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  nombre      text not null,
  especie     text not null check (especie in ('Perro', 'Gato')),
  raza        text not null,
  edad        int  check (edad is null or edad between 0 and 40),
  created_at  timestamptz not null default now()
);

create table public.citas (
  id                bigint generated always as identity primary key,
  user_id           uuid   not null references public.profiles(id) on delete cascade,
  -- RESTRICT: no se puede borrar una mascota que tenga citas
  mascota_id        bigint not null references public.mascotas(id) on delete restrict,
  servicio          text   not null,
  estilo_corte      text,
  especificaciones  text,
  requiere_ruta     boolean not null default false,
  direccion         text,
  fecha_hora        timestamptz not null,
  estado            text not null default 'Pendiente'
                    check (estado in ('Pendiente','Aprobada','En proceso','Rechazada','Entregada','Cancelada')),
  created_at        timestamptz not null default now(),

  -- Si pide ruta, la dirección es obligatoria
  constraint ruta_requiere_direccion
    check (not requiere_ruta or length(trim(coalesce(direccion, ''))) > 0),
  -- Las citas van en bloques de 30 minutos (10:00, 10:30, ...)
  constraint cita_bloque_30min
    check (extract(minute from fecha_hora at time zone 'UTC') in (0, 30)
           and extract(second from fecha_hora at time zone 'UTC') = 0)
);

-- Prevención de solapamiento: dos citas ACTIVAS no pueden tener la misma fecha y hora.
-- (Si una se cancela o se rechaza, el horario queda libre otra vez.)
create unique index citas_horario_unico
  on public.citas (fecha_hora)
  where estado in ('Pendiente', 'Aprobada', 'En proceso');

create index idx_mascotas_user on public.mascotas(user_id);
create index idx_citas_user    on public.citas(user_id);

-- ---------------------------------------------------------------------
-- 2) Funciones y triggers
-- ---------------------------------------------------------------------

-- ¿El usuario actual es administrador? (security definer evita recursión en RLS)
create or replace function public.es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol = 'ADMINISTRADOR'
  );
$$;

-- Al registrarse un usuario (auth.users) se crea su perfil SIEMPRE como CLIENTE.
-- Aunque alguien intente enviar otro rol desde el navegador, se ignora.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, telefono, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'telefono', ''),
    'CLIENTE'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ciclo de estados: no se puede saltar pasos ni retroceder.
--   Pendiente  -> Aprobada | Rechazada | Cancelada
--   Aprobada   -> En proceso | Rechazada
--   En proceso -> Entregada
create or replace function public.validar_transicion_estado()
returns trigger
language plpgsql
as $$
begin
  if new.estado = old.estado then
    return new;
  end if;

  if not (
    (old.estado = 'Pendiente'  and new.estado in ('Aprobada', 'Rechazada', 'Cancelada')) or
    (old.estado = 'Aprobada'   and new.estado in ('En proceso', 'Rechazada')) or
    (old.estado = 'En proceso' and new.estado = 'Entregada')
  ) then
    raise exception 'No se puede cambiar una cita de "%" a "%"', old.estado, new.estado;
  end if;

  return new;
end;
$$;

create trigger citas_validar_estado
  before update on public.citas
  for each row execute function public.validar_transicion_estado();

-- Perfiles para usuarios que ya existían antes de este script
insert into public.profiles (id, nombre, telefono, rol)
select id,
       coalesce(raw_user_meta_data->>'nombre', ''),
       coalesce(raw_user_meta_data->>'telefono', ''),
       'CLIENTE'
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3) Seguridad (RLS): cada usuario solo ve y toca lo suyo
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.mascotas enable row level security;
alter table public.citas    enable row level security;

revoke all on public.profiles, public.mascotas, public.citas from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.mascotas, public.citas to authenticated;

-- PROFILES
-- Nadie puede modificar su perfil desde la web (así nadie se puede volver
-- administrador). El rol solo se cambia desde el SQL Editor.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.es_admin());

-- Respaldo: si por algún motivo falta el perfil, el usuario solo puede crearse uno CLIENTE.
create policy profiles_insert_propio on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and rol = 'CLIENTE');

-- MASCOTAS: el cliente hace CRUD de las suyas; el administrador las puede ver.
create policy mascotas_select on public.mascotas
  for select to authenticated
  using (user_id = auth.uid() or public.es_admin());

create policy mascotas_insert on public.mascotas
  for insert to authenticated
  with check (user_id = auth.uid());

create policy mascotas_update on public.mascotas
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy mascotas_delete on public.mascotas
  for delete to authenticated
  using (user_id = auth.uid());

-- CITAS
create policy citas_select on public.citas
  for select to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- Crear: solo a nombre propio, con una mascota propia, en estado Pendiente y a futuro.
create policy citas_insert on public.citas
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and estado = 'Pendiente'
    and fecha_hora > now()
    and exists (select 1 from public.mascotas m where m.id = mascota_id and m.user_id = auth.uid())
  );

-- El cliente solo puede CANCELAR sus citas que sigan Pendientes.
create policy citas_cancelar_propia on public.citas
  for update to authenticated
  using (user_id = auth.uid() and estado = 'Pendiente')
  with check (user_id = auth.uid() and estado = 'Cancelada');

-- El administrador cambia el estado de cualquier cita (el trigger valida el orden).
create policy citas_update_admin on public.citas
  for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ---------------------------------------------------------------------
-- 4) Tiempo real: avisa a la página cuando cambia una cita
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.citas;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- =====================================================================
-- LISTO. Para volver ADMINISTRADOR a una cuenta (primero regístrala
-- desde la página como cualquier cliente) ejecuta, cambiando el correo:
--
--   update public.profiles
--   set rol = 'ADMINISTRADOR'
--   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
-- =====================================================================
