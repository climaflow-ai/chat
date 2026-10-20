-- Запускать ПОСЛЕ database2.sql. Фото, реакции, закрепление, медленный режим, «Тайный собеседник».
alter table messages add column image_url text check(image_url is null or image_url like 'https://%/storage/v1/object/public/photos/%'), add column pinned boolean not null default false;
alter table dm_messages add column image_url text check(image_url is null or image_url like 'https://%/storage/v1/object/public/photos/%');
drop policy "messages insert own" on messages;
create policy "messages insert own" on messages for insert to authenticated with check(user_id=auth.uid() and not pinned and not exists(select 1 from profiles where id=auth.uid() and banned));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('photos','photos',true,2097152,array['image/jpeg','image/png','image/webp']) on conflict do nothing;
create policy "photos upload own" on storage.objects for insert to authenticated with check(bucket_id='photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated using(bucket_id='photos' and (storage.foldername(name))[1]=auth.uid()::text);

create table reactions(message_id bigint references messages on delete cascade, user_id uuid references auth.users on delete cascade default auth.uid(),
  emoji text check(char_length(emoji)<=8), primary key(message_id,user_id,emoji));
alter table reactions enable row level security;
create policy "rx read" on reactions for select to authenticated using(true);
create policy "rx ins" on reactions for insert to authenticated with check(user_id=auth.uid());
create policy "rx del" on reactions for delete to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table reactions;

create function pin_message(m bigint,p boolean) returns void language sql security definer set search_path=public as $$
 update messages set pinned=p where id=m and is_mod() $$;

-- медленный режим: settings.slow = секунды между сообщениями (по умолчанию 2)
create or replace function rate_limit() returns trigger language plpgsql as $$
declare s int:=coalesce((select value::int from settings where key='slow'),2);
begin
  if exists(select 1 from messages where user_id=new.user_id and created_at>now()-make_interval(secs=>s)) then
    raise exception 'Слишком часто. Подождите % с.',s; end if;
  return new;
end $$;

-- «Тайный собеседник»
create table queue(user_id uuid primary key references auth.users on delete cascade, topic text not null, dialog_id bigint, created_at timestamptz default now());
alter table queue enable row level security; -- политик нет: доступ только через функции
create function find_partner(t text) returns bigint language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); q queue; o queue; d bigint;
begin
  if exists(select 1 from profiles where id=me and banned) then raise exception 'Недоступно'; end if;
  select * into q from queue where user_id=me;
  if q.dialog_id is not null then delete from queue where user_id=me; return q.dialog_id; end if;
  select * into o from queue where user_id<>me and dialog_id is null and topic=t and created_at>now()-interval '2 minutes'
    and not exists(select 1 from blocks b where (b.blocker=me and b.blocked=queue.user_id) or (b.blocker=queue.user_id and b.blocked=me))
    order by created_at limit 1 for update skip locked;
  if o.user_id is not null then
    insert into dialogs(a,b,status) values(me,o.user_id,'accepted') on conflict(a,b) do update set status='accepted' returning id into d;
    update queue set dialog_id=d where user_id=o.user_id; delete from queue where user_id=me; return d;
  end if;
  insert into queue(user_id,topic) values(me,t) on conflict(user_id) do update set topic=t;
  return null;
end $$;
create function cancel_search() returns void language sql security definer set search_path=public as $$ delete from queue where user_id=auth.uid() and dialog_id is null $$;
