-- Запускать ПОСЛЕ database.sql. Раскрытие личности, личные сообщения, модерация.
alter table profiles add column role text not null default 'user' check (role in('user','moderator','admin')), add column banned boolean not null default false;
drop policy "profiles insert own" on profiles;
create policy "profiles insert own" on profiles for insert to authenticated with check (id=auth.uid() and role='user' and not banned);
create function protect_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from profiles where id=auth.uid() and role='admin') then new.role:=old.role; new.banned:=old.banned; end if;
  return new;
end $$;
create trigger prot before update on profiles for each row execute function protect_profile();

create function is_mod() returns boolean language sql security definer stable set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role in('admin','moderator')) $$;
create function is_admin() returns boolean language sql security definer stable set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;

-- приватные данные: читает только владелец; другим отдаёт функция get_revealed
create table profile_private(user_id uuid primary key references auth.users on delete cascade,
  real_name text check(char_length(real_name)<=60), age int check(age between 14 and 120), city text check(char_length(city)<=60),
  about text check(char_length(about)<=300), max_link text check(char_length(max_link)<=200));
alter table profile_private enable row level security;
create policy "own private" on profile_private for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create table reveals(owner uuid references auth.users on delete cascade, viewer uuid references auth.users on delete cascade,
  fields text[] not null, status text not null default 'pending' check(status in('pending','accepted','declined')),
  primary key(owner,viewer), check(owner<>viewer));
alter table reveals enable row level security;
create policy "rev read" on reveals for select to authenticated using(owner=auth.uid() or viewer=auth.uid());
create policy "rev ins" on reveals for insert to authenticated with check(owner=auth.uid() and status='pending');
create policy "rev upd" on reveals for update to authenticated using(owner=auth.uid()) with check(owner=auth.uid() and status='pending');
create policy "rev del" on reveals for delete to authenticated using(owner=auth.uid());

create function get_revealed(o uuid) returns jsonb language sql security definer stable set search_path=public as $$
 select coalesce((select jsonb_object_agg(k, to_jsonb(p)->k) from reveals r join profile_private p on p.user_id=r.owner, unnest(r.fields) k
  where r.owner=o and r.viewer=auth.uid() and r.status='accepted' and k in('real_name','age','city','about','max_link')),'{}'::jsonb) $$;
create function respond_reveal(o uuid, ok boolean) returns void language sql security definer set search_path=public as $$
 update reveals set status=case when ok then 'accepted' else 'declined' end where owner=o and viewer=auth.uid() and status='pending' $$;

create table blocks(blocker uuid references auth.users on delete cascade default auth.uid(), blocked uuid references auth.users on delete cascade, primary key(blocker,blocked));
alter table blocks enable row level security;
create policy "blk own" on blocks for all to authenticated using(blocker=auth.uid()) with check(blocker=auth.uid());

create table dialogs(id bigserial primary key, a uuid not null references auth.users on delete cascade default auth.uid(), b uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check(status in('pending','accepted','declined')), unique(a,b), check(a<>b));
alter table dialogs enable row level security;
create policy "dlg read" on dialogs for select to authenticated using(auth.uid() in(a,b));
create policy "dlg ins" on dialogs for insert to authenticated with check(a=auth.uid() and status='pending' and not exists(select 1 from profiles where id=auth.uid() and banned));
create function respond_dialog(d bigint, ok boolean) returns void language sql security definer set search_path=public as $$
 update dialogs set status=case when ok then 'accepted' else 'declined' end where id=d and b=auth.uid() and status='pending' $$;

create table dm_messages(id bigserial primary key, dialog_id bigint not null references dialogs on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(), body text not null check(char_length(body) between 1 and 1000), created_at timestamptz default now());
create index on dm_messages(dialog_id, created_at);
alter table dm_messages enable row level security;
create policy "dm read" on dm_messages for select to authenticated using(exists(select 1 from dialogs d where d.id=dialog_id and d.status='accepted' and auth.uid() in(d.a,d.b)));
create policy "dm ins" on dm_messages for insert to authenticated with check(user_id=auth.uid() and not exists(select 1 from profiles where id=auth.uid() and banned)
  and exists(select 1 from dialogs d where d.id=dialog_id and d.status='accepted' and auth.uid() in(d.a,d.b)
  and not exists(select 1 from blocks b where (b.blocker=d.a and b.blocked=d.b) or (b.blocker=d.b and b.blocked=d.a))));
alter publication supabase_realtime add table dm_messages;

create table reports(id bigserial primary key, reporter uuid not null references auth.users on delete cascade default auth.uid(),
  message_id bigint references messages on delete cascade, reason text check(char_length(reason)<=300), created_at timestamptz default now());
alter table reports enable row level security;
create policy "rep ins" on reports for insert to authenticated with check(reporter=auth.uid());
create policy "rep mod read" on reports for select to authenticated using(is_mod());
create policy "rep mod del" on reports for delete to authenticated using(is_mod());

create table settings(key text primary key, value text);
alter table settings enable row level security;
create policy "set read" on settings for select to authenticated using(true);
create policy "set admin" on settings for all to authenticated using(is_admin()) with check(is_admin());
create policy "rooms admin" on rooms for all to authenticated using(is_admin()) with check(is_admin());

drop policy "messages insert own" on messages;
create policy "messages insert own" on messages for insert to authenticated with check(user_id=auth.uid() and not exists(select 1 from profiles where id=auth.uid() and banned));
create policy "messages mod delete" on messages for delete to authenticated using(is_mod());

create function ban_user(u uuid) returns void language sql security definer set search_path=public as $$
 update profiles set banned=true where id=u and is_mod() $$;
create function delete_account() returns void language sql security definer set search_path=public as $$ delete from auth.users where id=auth.uid() $$;
-- Назначить администратора (подставьте свой id из таблицы profiles):
-- update profiles set role='admin' where id='ВАШ-UUID';
