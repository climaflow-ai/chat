create table profiles(
  id uuid primary key references auth.users on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  avatar text not null default '🤫',
  created_at timestamptz default now());
create table rooms(
  id serial primary key, icon text, title text not null, descr text);
create table messages(
  id bigserial primary key,
  room_id int not null references rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 1000),
  reply_to bigint references messages on delete set null,
  created_at timestamptz default now());
create index on messages(room_id, created_at desc);

alter table profiles enable row level security;
alter table rooms enable row level security;
alter table messages enable row level security;

create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles insert own" on profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on profiles for update to authenticated using (id = auth.uid());
create policy "profiles delete own" on profiles for delete to authenticated using (id = auth.uid());
create policy "rooms read" on rooms for select to authenticated using (true);
create policy "messages read" on messages for select to authenticated using (true);
create policy "messages insert own" on messages for insert to authenticated with check (user_id = auth.uid());
create policy "messages delete own" on messages for delete to authenticated using (user_id = auth.uid());

-- антиспам: не чаще 1 сообщения в 2 секунды
create function rate_limit() returns trigger language plpgsql as $$
begin
  if exists(select 1 from messages where user_id=new.user_id and created_at > now()-interval '2 seconds') then
    raise exception 'Слишком часто. Подождите пару секунд.';
  end if;
  return new;
end $$;
create trigger msg_rate before insert on messages for each row execute function rate_limit();

alter publication supabase_realtime add table messages;

insert into rooms(icon,title,descr) values
('☕','За чашкой кофе','Общение обо всём'),('❤️','Знакомства','Знакомства, дружба, отношения'),
('🤫','Тайны и признания','Анонимные истории'),('🏖','Евпатория','Новости, события, вопросы'),
('🌴','Крымский разговор','Общение жителей полуострова'),('🛠','Соседи помогают','Помощь и советы'),
('🚗','Попутчики','Поездки по Крыму'),('💼','Работа и подработка','Поиск работы'),
('😂','Юмор','Анекдоты, истории, шутки'),('💡','Вопрос — ответ','Советы и обсуждения');
