-- Запускать ПОСЛЕ database3.sql. Игра «Имаджинариум»: вся логика и скрытая информация на сервере.
create table games(id bigserial primary key, host uuid not null references auth.users on delete cascade default auth.uid(),
  status text not null default 'lobby' check(status in('lobby','playing','finished')), phase text not null default 'clue',
  round int not null default 0, storyteller uuid, clue text, story_card int, updated_at timestamptz default now(), created_at timestamptz default now());
create table game_secret(game_id bigint primary key references games on delete cascade, deck int[] not null default '{}');
create table game_players(game_id bigint references games on delete cascade, user_id uuid references auth.users on delete cascade,
  seat int not null, score int not null default 0, primary key(game_id,user_id));
create table game_hands(game_id bigint references games on delete cascade, user_id uuid references auth.users on delete cascade,
  hand int[] not null default '{}', primary key(game_id,user_id));
create table game_plays(game_id bigint references games on delete cascade, round int, user_id uuid references auth.users on delete cascade,
  card int not null, vote_card int, is_story boolean not null default false, primary key(game_id,round,user_id));
alter table games enable row level security; alter table game_secret enable row level security;
alter table game_players enable row level security; alter table game_hands enable row level security; alter table game_plays enable row level security;
create policy "g read" on games for select to authenticated using(true);
create policy "gp read" on game_players for select to authenticated using(true);
create policy "gh own" on game_hands for select to authenticated using(user_id=auth.uid());
alter publication supabase_realtime add table games, game_players;

create function create_game() returns bigint language plpgsql security definer set search_path=public as $$
declare g bigint; begin
  insert into games(host) values(auth.uid()) returning id into g;
  insert into game_secret(game_id) values(g);
  insert into game_players(game_id,user_id,seat) values(g,auth.uid(),1);
  insert into game_hands(game_id,user_id) values(g,auth.uid());
  return g; end $$;

create function join_game(g bigint) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from games where id=g and status='lobby') then raise exception 'Игра уже началась'; end if;
  if (select count(*) from game_players where game_id=g)>=8 then raise exception 'Комната заполнена'; end if;
  insert into game_players(game_id,user_id,seat) values(g,auth.uid(),(select coalesce(max(seat),0)+1 from game_players where game_id=g)) on conflict do nothing;
  insert into game_hands(game_id,user_id) values(g,auth.uid()) on conflict do nothing;
  update games set updated_at=now() where id=g; end $$;

create function start_game(g bigint) returns void language plpgsql security definer set search_path=public as $$
declare p record; d int[]; begin
  if not exists(select 1 from games where id=g and host=auth.uid() and status='lobby') then raise exception 'Нет доступа'; end if;
  if (select count(*) from game_players where game_id=g)<3 then raise exception 'Нужно минимум 3 игрока'; end if;
  select array_agg(i order by random()) into d from generate_series(1,84) i;
  for p in select user_id from game_players where game_id=g order by seat loop
    update game_hands set hand=d[1:6] where game_id=g and user_id=p.user_id; d:=d[7:];
  end loop;
  update game_secret set deck=d where game_id=g;
  update games set status='playing',phase='clue',round=1,updated_at=now(),
    storyteller=(select user_id from game_players where game_id=g order by seat limit 1) where id=g; end $$;

create function give_clue(g bigint, c int, t text) returns void language plpgsql security definer set search_path=public as $$
declare r games; begin
  select * into r from games where id=g and status='playing' and phase='clue' and storyteller=auth.uid();
  if r.id is null then raise exception 'Сейчас не ваш ход'; end if;
  if char_length(trim(coalesce(t,''))) not between 1 and 100 then raise exception 'Ассоциация: от 1 до 100 символов'; end if;
  update game_hands set hand=array_remove(hand,c) where game_id=g and user_id=auth.uid() and c=any(hand);
  if not found then raise exception 'Нет такой карты'; end if;
  insert into game_plays(game_id,round,user_id,card,is_story) values(g,r.round,auth.uid(),c,true);
  update games set phase='pick',clue=trim(t),story_card=c,updated_at=now() where id=g; end $$;

create function pick_card(g bigint, c int) returns void language plpgsql security definer set search_path=public as $$
declare r games; n int; m int; begin
  select * into r from games where id=g and status='playing' and phase='pick';
  if r.id is null or r.storyteller=auth.uid() then raise exception 'Сейчас нельзя'; end if;
  if not exists(select 1 from game_players where game_id=g and user_id=auth.uid()) then raise exception 'Вы не в игре'; end if;
  if exists(select 1 from game_plays where game_id=g and round=r.round and user_id=auth.uid()) then raise exception 'Вы уже выбрали карту'; end if;
  update game_hands set hand=array_remove(hand,c) where game_id=g and user_id=auth.uid() and c=any(hand);
  if not found then raise exception 'Нет такой карты'; end if;
  insert into game_plays(game_id,round,user_id,card) values(g,r.round,auth.uid(),c);
  select count(*) into n from game_plays where game_id=g and round=r.round;
  select count(*) into m from game_players where game_id=g;
  update games set phase=case when n=m then 'vote' else phase end, updated_at=now() where id=g; end $$;

create function vote_card(g bigint, c int) returns void language plpgsql security definer set search_path=public as $$
declare r games; n int; m int; k int; begin
  select * into r from games where id=g and status='playing' and phase='vote';
  if r.id is null or r.storyteller=auth.uid() then raise exception 'Сейчас нельзя'; end if;
  if not exists(select 1 from game_plays where game_id=g and round=r.round and card=c) then raise exception 'Нет такой карты'; end if;
  update game_plays set vote_card=c where game_id=g and round=r.round and user_id=auth.uid() and vote_card is null and card<>c;
  if not found then raise exception 'Нельзя голосовать за свою карту или повторно'; end if;
  select count(*) into n from game_plays where game_id=g and round=r.round and vote_card is not null;
  select count(*) into m from game_players where game_id=g;
  if n=m-1 then
    select count(*) into k from game_plays where game_id=g and round=r.round and vote_card=r.story_card;
    if k=0 or k=m-1 then
      update game_players set score=score+2 where game_id=g and user_id<>r.storyteller;
    else
      update game_players set score=score+3 where game_id=g and user_id=r.storyteller;
      update game_players gp set score=gp.score+3 from game_plays p where p.game_id=g and p.round=r.round and p.user_id=gp.user_id and gp.game_id=g and p.vote_card=r.story_card;
    end if;
    update game_players gp set score=gp.score+(select count(*) from game_plays v where v.game_id=g and v.round=r.round and v.vote_card=o.card)
      from game_plays o where o.game_id=g and o.round=r.round and o.user_id=gp.user_id and gp.game_id=g and o.user_id<>r.storyteller;
    update games set phase='result',updated_at=now() where id=g;
  else update games set updated_at=now() where id=g; end if; end $$;

create function next_round(g bigint) returns void language plpgsql security definer set search_path=public as $$
declare r games; d int[]; p record; mx int; m int; begin
  select * into r from games where id=g and status='playing' and phase='result';
  if r.id is null or not exists(select 1 from game_players where game_id=g and user_id=auth.uid()) then raise exception 'Нет доступа'; end if;
  select max(score),count(*) into mx,m from game_players where game_id=g;
  select deck into d from game_secret where game_id=g;
  if mx>=30 or coalesce(array_length(d,1),0)<m then update games set status='finished',updated_at=now() where id=g; return; end if;
  for p in select user_id from game_players where game_id=g loop
    update game_hands set hand=hand||d[1:1] where game_id=g and user_id=p.user_id; d:=d[2:];
  end loop;
  update game_secret set deck=d where game_id=g;
  update games set phase='clue',round=round+1,clue=null,story_card=null,updated_at=now(),
    storyteller=coalesce((select user_id from game_players where game_id=g and seat>(select seat from game_players where game_id=g and user_id=r.storyteller) order by seat limit 1),
                         (select user_id from game_players where game_id=g order by seat limit 1)) where id=g; end $$;

create function game_state(g bigint) returns jsonb language plpgsql security definer stable set search_path=public as $$
declare r games; begin
  select * into r from games where id=g;
  if not exists(select 1 from game_players where game_id=g and user_id=auth.uid()) then raise exception 'Вы не в этой игре'; end if;
  return (to_jsonb(r)-'story_card') || jsonb_build_object(
   'players',(select jsonb_agg(jsonb_build_object('id',gp.user_id,'nick',p.nickname,'avatar',p.avatar,'score',gp.score,
        'played',exists(select 1 from game_plays x where x.game_id=g and x.round=r.round and x.user_id=gp.user_id),
        'voted',exists(select 1 from game_plays x where x.game_id=g and x.round=r.round and x.user_id=gp.user_id and x.vote_card is not null)) order by gp.seat)
      from game_players gp join profiles p on p.id=gp.user_id where gp.game_id=g),
   'hand',coalesce((select to_jsonb(hand) from game_hands where game_id=g and user_id=auth.uid()),'[]'::jsonb),
   'mine',(select card from game_plays where game_id=g and round=r.round and user_id=auth.uid()),
   'my_vote',(select vote_card from game_plays where game_id=g and round=r.round and user_id=auth.uid()),
   'table',case
     when r.phase='vote' then (select coalesce(jsonb_agg(jsonb_build_object('card',card) order by md5(card::text||g::text||r.round::text)),'[]'::jsonb) from game_plays where game_id=g and round=r.round)
     when r.phase='result' then (select coalesce(jsonb_agg(jsonb_build_object('card',pl.card,'owner',pl.user_id,'story',pl.is_story,
        'votes',(select coalesce(jsonb_agg(v.user_id),'[]'::jsonb) from game_plays v where v.game_id=g and v.round=r.round and v.vote_card=pl.card)) order by pl.card),'[]'::jsonb)
        from game_plays pl where pl.game_id=g and pl.round=r.round)
     else '[]'::jsonb end); end $$;
