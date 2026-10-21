const $=s=>document.querySelector(s);
const sb=supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY);
const PRESETS=["🐈 Рыжий кот","🕊️ Морская чайка","🌊 Морской волк","🌅 Крымский рассвет","🐬 Дельфин","☕ Кофе у моря","🤫 Незнакомец","🐱 Свободная кошка","🥟 Пирожок","👑 Царь","🦐 Креветка","🪼 Медуза","😇 Хороший человек","😈 Стервец","💅 Всегда права","☀️ Солнце","🍬 Сладкая","⭐ Звезда","🦔 Ёж","🦔 Ежиха","🐺 Койот","🦊 Лиса"];
const blocked=new Set();let me=null,room=null,chan=null,reply=null,profiles={},msgById={};
const show=id=>["login","rooms","chat"].forEach(s=>$("#"+s).hidden=s!==id);
const esc=(el,t)=>{el.textContent=t;return el};
const split=n=>{const m=n.match(/^(\S+)\s+(.+)$/u);return m&&/\p{Extended_Pictographic}/u.test(m[1])?[m[1],m[2]]:["🤫",n]};

$("#theme").onclick=()=>{const d=document.documentElement;d.dataset.theme=d.dataset.theme==="dark"?"":"dark";localStorage.theme=d.dataset.theme};
document.documentElement.dataset.theme=localStorage.theme||"";
PRESETS.forEach(p=>{const b=document.createElement("button");b.textContent=p;b.onclick=()=>{$("#nick").value=p;document.querySelectorAll("#presets button").forEach(x=>x.classList.toggle("sel",x===b))};$("#presets").append(b)});

async function init(){
  let {data:{session}}=await sb.auth.getSession();
  if(!session){const r=await sb.auth.signInAnonymously();if(r.error)return alert("Не удалось войти: "+r.error.message);session=r.data.session}
  me=session.user;
  const {data}=await sb.from("profiles").select("*").eq("id",me.id).maybeSingle();
  if(data){profiles[me.id]=data;openRooms()}else show("login");
}
$("#enter").onclick=async()=>{
  const v=$("#nick").value.trim();if(v.length<2)return alert("Введите имя (от 2 символов)");
  const [avatar,nickname]=split(v);
  const {data,error}=await sb.from("profiles").upsert({id:me.id,nickname,avatar}).select().single();
  if(error)return alert(error.message);profiles[me.id]=data;openRooms();
};
async function openRooms(){
  leave();show("rooms");$("#back").hidden=true;$("#title").textContent="🌊 Крым без имён";
  const {data}=await sb.from("rooms").select("*").order("id");
  $("#rooms").replaceChildren(...data.map(r=>{const b=document.createElement("button");b.className="room";b.dataset.id=r.id;
    b.append(esc(document.createElement("div"),`${r.icon} ${r.title}`),esc(document.createElement("small"),r.descr||""));
    b.onclick=()=>openRoom(r);return b}));
}
async function loadProfiles(ids){
  const need=[...new Set(ids)].filter(i=>!profiles[i]);if(!need.length)return;
  const {data}=await sb.from("profiles").select("*").in("id",need);(data||[]).forEach(p=>profiles[p.id]=p);
}
async function openRoom(r){
  room=r;msgById={};show("chat");$("#back").hidden=false;$("#title").textContent=`${r.icon} ${r.title}`;$("#msgs").replaceChildren();
  const {data}=await sb.from("messages").select("*").eq("room_id",r.id).order("created_at",{ascending:false}).limit(100);
  const list=(data||[]).reverse();await loadProfiles(list.map(m=>m.user_id));list.forEach(add);scroll(true);
  chan=sb.channel("room-"+r.id)
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"room_id=eq."+r.id},async p=>{
      await loadProfiles([p.new.user_id]);const nb=nearBottom();add(p.new);if(nb)scroll()})
   .on("postgres_changes",{event:"DELETE",schema:"public",table:"messages"},p=>{document.getElementById("m"+p.old.id)?.remove()})
   .subscribe();
}
const nearBottom=()=>{const e=$("#msgs");return e.scrollHeight-e.scrollTop-e.clientHeight<80};
const scroll=()=>{const e=$("#msgs");e.scrollTop=e.scrollHeight};
function add(m){
  if(blocked.has(m.user_id))return;msgById[m.id]=m;const p=profiles[m.user_id]||{nickname:"Аноним",avatar:"🤫"};
  const d=document.createElement("div");d.className="m"+(m.user_id===me.id?" me":"");d.id="m"+m.id;
  if(m.reply_to&&msgById[m.reply_to]){const q=msgById[m.reply_to];d.append(esc(document.createElement("div"),`↪ ${(profiles[q.user_id]||{}).nickname||"Аноним"}: ${q.body.slice(0,60)}`));d.lastChild.className="q"}
  const h=document.createElement("b");h.textContent=`${p.avatar} ${p.nickname}`;
  const t=document.createElement("time");t.textContent=new Date(m.created_at).toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"});
  const body=esc(document.createElement("div"),m.body);
  const a=document.createElement("div");
  const r=document.createElement("span");r.className="act";r.textContent="Ответить";r.onclick=()=>{reply=m.id;$("#replybar").hidden=false;$("#replytxt").textContent="Ответ: "+m.body.slice(0,50);$("#text").focus()};a.append(r);
  if(m.user_id===me.id){const x=document.createElement("span");x.className="act";x.textContent="Удалить";x.onclick=async()=>{await sb.from("messages").delete().eq("id",m.id)};a.append(x)}
  h.style.cursor="pointer";h.onclick=()=>m.user_id!==me.id&&card(m.user_id);
  if(m.user_id!==me.id){const f=document.createElement("span");f.className="act";f.textContent="Пожаловаться";f.onclick=async()=>{const reason=prompt("Причина жалобы?");if(reason===null)return;const {error}=await sb.from("reports").insert({message_id:m.id,reason});alert(error?error.message:"Жалоба отправлена")};a.append(f)}
  d.append(h,t,body,a);$("#msgs").append(d);
}
$("#cancel").onclick=()=>{reply=null;$("#replybar").hidden=true};
async function send(){if(window.dmId)return dmSend();
  const body=$("#text").value.trim();if(!body)return;$("#text").value="";
  const {error}=await sb.from("messages").insert({room_id:room.id,body,reply_to:reply});
  if(error){alert(error.message);$("#text").value=body}$("#cancel").onclick();
}
$("#send").onclick=send;$("#text").onkeydown=e=>{if(e.key==="Enter")send()};
function leave(){if(chan){sb.removeChannel(chan);chan=null}room=null}
$("#back").onclick=()=>openRooms();
init();
