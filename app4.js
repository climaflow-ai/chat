const EMO=["🌙","🦋","🏰","🐋","🌲","🎈","🗝️","🕯️","🚪","🦉","🌊","🪐","🍄","🕰️","🪞","🐚","🌹","⛵","🔮","🦢","🌋","🎭","🐘","📜","🪁","🌈","🦊","🏔️","🎻","🌸"];
let G=null,gch=null,gtimer=null,sel=null,ctext="";
const gs=document.createElement("section");gs.id="game";gs.hidden=true;$("main").append(gs);
function gcard(id,cls){
  let s=id*7919;const R=n=>{s=(s*9301+49297)%233280;return s/233280*n};
  const d=el("div");d.className="gc "+(cls||"");
  d.style.background=`linear-gradient(${R(360)|0}deg,hsl(${R(360)|0} 70% 72%),hsl(${R(360)|0} 60% 45%))`;
  for(let i=0;i<3;i++){const e=el("span",EMO[R(EMO.length)|0]);e.style.cssText=`left:${R(50)|0}%;top:${R(55)|0}%;font-size:${(32+R(30))|0}px;transform:rotate(${(R(60)-30)|0}deg)`;d.append(e)}
  // Если рядом лежит настоящая картинка assets/cards/<номер>.jpg, показываем её, иначе остаётся сгенерированная
  const im=new Image();im.className="cimg";im.alt="";im.onload=()=>d.replaceChildren(im);im.src=`assets/cards/${id}.jpg`;
  return d;
}
function gleave(){G=null;sel=null;ctext="";clearInterval(gtimer);if(gch){sb.removeChannel(gch);gch=null}delete gs.dataset.j}
const _or4=openRooms;
openRooms=async function(){gs.hidden=true;gleave();await _or4();$("#rooms").firstChild.append(el("button","🎴 Имаджинариум",lobbyList))};
async function lobbyList(){
  const [a,b]=await Promise.all([sb.from("games").select("id,host").eq("status","lobby").order("id",{ascending:false}).limit(10),
    sb.from("game_players").select("game_id,games(status)").eq("user_id",me.id)]);
  const mine=(b.data||[]).filter(x=>x.games&&x.games.status!=="finished").map(x=>x.game_id);
  const open=(a.data||[]).filter(g=>!mine.includes(g.id));await loadProfiles(open.map(g=>g.host));
  const n=[el("h3","🎴 Имаджинариум"),el("p","3–8 игроков. Рассказчик загадывает ассоциацию к карте, остальные подкладывают подходящие карты и угадывают. Игра идёт до 30 очков."),
    el("button","➕ Создать игру",async()=>{const {data,error}=await sb.rpc("create_game");if(error)return alert(error.message);close();openGame(data)})];
  mine.forEach(id=>n.push(el("button","▶ Продолжить игру №"+id,()=>{close();openGame(id)})));
  open.forEach(g=>n.push(el("button","Присоединиться: игра "+((profiles[g.host]||{}).nickname||""),async()=>{const {error}=await sb.rpc("join_game",{g:g.id});if(error)return alert(error.message);close();openGame(g.id)})));
  modal(...n);
}
function openGame(id){
  leave();gleave();show("none");gs.hidden=false;$("#back").hidden=false;$("#title").textContent="🎴 Имаджинариум";G={id};
  gch=sb.channel("g"+id).on("postgres_changes",{event:"*",schema:"public",table:"games",filter:"id=eq."+id},gref)
    .on("postgres_changes",{event:"*",schema:"public",table:"game_players",filter:"game_id=eq."+id},gref).subscribe();
  gtimer=setInterval(gref,6000);gref();
}
async function gref(){
  if(!G)return;const id=G.id;const {data,error}=await sb.rpc("game_state",{g:id});if(error||!data||!G)return;
  const k=data.round+data.phase;if(gs.dataset.k!==k){sel=null;gs.dataset.k=k}
  const j=JSON.stringify(data);if(j===gs.dataset.j)return;gs.dataset.j=j;G=data;gdraw(data);
}
async function call(fn,args){const {error}=await sb.rpc(fn,args);if(error)alert(error.message);else gref()}
function gdraw(s){
  const story=s.storyteller===me.id,n=[],P=id=>s.players.find(x=>x.id===id);
  const nm=id=>P(id)?P(id).avatar+" "+P(id).nick:"?";
  const sc=el("div");sc.className="gscore";s.players.forEach(p=>sc.append(el("span",`${p.avatar} ${p.nick}: ${p.score}`)));n.push(sc);
  const act=(t,fn)=>{const b=el("button",t,fn);b.className="big";return b};
  const hand=can=>{const w=el("div");w.className="ghand";s.hand.forEach(c=>{const e=gcard(c,sel===c?"sel":"");if(can)e.onclick=()=>{sel=c;gdraw(s)};w.append(e)});return w};
  const need=()=>{if(sel==null){alert("Сначала выберите карту");return false}return true};
  if(s.status==="lobby"){
    n.push(el("h3","Ждём игроков ("+s.players.length+"/8)"));
    n.push(s.host===me.id?act("Начать игру",()=>call("start_game",{g:s.id})):el("p","Ждём, пока организатор начнёт игру."));
    n.push(el("p","Пригласите друзей: игра появится в списке «Имаджинариум» на главном экране."));
  }else if(s.status==="finished"){
    const top=[...s.players].sort((a,b)=>b.score-a.score)[0];n.push(el("h3","🏆 Игра окончена. Победитель: "+top.avatar+" "+top.nick+" ("+top.score+")"));
  }else if(s.phase==="clue"){
    if(story){n.push(el("p","Вы рассказчик. Выберите карту и придумайте ассоциацию (слово, фразу, песню…)."),hand(true));
      const i=el("input");i.placeholder="Ваша ассоциация";i.maxLength=100;i.value=ctext;i.oninput=()=>ctext=i.value;n.push(i,
      act("Загадать",()=>need()&&call("give_clue",{g:s.id,c:sel,t:ctext})))}
    else n.push(el("p",nm(s.storyteller)+" придумывает ассоциацию…"),hand(false));
  }else if(s.phase==="pick"){
    n.push(el("h3","Ассоциация: «"+s.clue+"»"));
    if(story||s.mine!=null)n.push(el("p","Ждём остальных игроков: "+s.players.filter(p=>p.played).length+"/"+s.players.length),hand(false));
    else n.push(el("p","Выберите карту, которая лучше всего подходит к ассоциации."),hand(true),act("Подложить карту",()=>need()&&call("pick_card",{g:s.id,c:sel})));
  }else if(s.phase==="vote"){
    n.push(el("h3","Ассоциация: «"+s.clue+"»"));
    const can=!story&&s.my_vote==null,w=el("div");w.className="gtable";
    s.table.forEach(t=>{const e=gcard(t.card,(sel===t.card?"sel ":"")+(t.card===s.mine?"mine":""));if(can&&t.card!==s.mine)e.onclick=()=>{sel=t.card;gdraw(s)};w.append(e)});n.push(w);
    n.push(can?el("p","Какая карта принадлежит рассказчику? Свою голосовать нельзя (она приглушена)."):el("p","Ждём голосов: "+s.players.filter(p=>p.voted).length+"/"+(s.players.length-1)));
    if(can)n.push(act("Голосовать",()=>need()&&call("vote_card",{g:s.id,c:sel})));
  }else{
    n.push(el("h3","Итоги раунда: «"+s.clue+"»"));const w=el("div");w.className="gtable";
    s.table.forEach(t=>{const c=el("div");c.append(gcard(t.card,t.story?"sel":""),el("small",nm(t.owner)+(t.story?" ★ рассказчик":"")),el("small","Голоса: "+(t.votes.length?t.votes.map(nm).join(", "):"—")));w.append(c)});n.push(w,act("Следующий раунд",()=>call("next_round",{g:s.id})));
  }
  gs.replaceChildren(...n);
}
