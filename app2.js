const el=(t,txt,fn)=>{const e=document.createElement(t);if(txt!=null)e.textContent=txt;if(fn)e.onclick=fn;return e};
const dlg=document.body.appendChild(document.createElement("dialog"));
const close=()=>dlg.close();
function modal(...n){if(dlg.open)dlg.close();dlg.replaceChildren(...n,el("button","Закрыть",close));dlg.showModal()}
const LBL={real_name:"Имя",age:"Возраст",city:"Город",about:"О себе",max_link:"MAX"};
let dch=null;
const _or=openRooms;
openRooms=async function(){
  window.dmId=null;if(dch){sb.removeChannel(dch);dch=null}
  await _or();
  const {data:b}=await sb.from("blocks").select("blocked").eq("blocker",me.id);blocked.clear();(b||[]).forEach(x=>blocked.add(x.blocked));
  const {data:p}=await sb.from("profiles").select("role").eq("id",me.id).single();
  window.myRole=p&&p.role;const {data:q}=await sb.from("settings").select("value").eq("key","qotd").maybeSingle();
  const bar=el("div");bar.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px";
  bar.append(el("button","✉ Сообщения",inbox),el("button","👤 Я",myProfile));
  if(p&&["admin","moderator"].includes(p.role))bar.append(el("button","🛡 Модерация",()=>admin(p.role)));
  const box=[bar];if(q&&q.value)box.push(el("p","💬 Вопрос дня: "+q.value));
  $("#rooms").prepend(...box);
};
async function card(uid){
  await loadProfiles([uid]);const p=profiles[uid];
  const {data:rv}=await sb.rpc("get_revealed",{o:uid});
  const info=Object.entries(rv||{}).filter(([k,v])=>v).map(([k,v])=>el("div",LBL[k]+": "+v));
  modal(el("h3",p.avatar+" "+p.nickname+" #"+uid.slice(0,4)),...info,
    el("button","💬 Предложить общение",async()=>{const {error}=await sb.from("dialogs").insert({b:uid});alert(error?"Запрос уже отправлен или недоступен":"Запрос отправлен");close()}),
    el("button","🔓 Открыть моё имя этому человеку",()=>revealForm(uid)),
    el("button","🚫 Заблокировать",async()=>{await sb.from("blocks").insert({blocked:uid});blocked.add(uid);close()}));
}
function revealForm(uid){
  const inp={};
  const rows=Object.entries(LBL).map(([k,l])=>{inp[k]=el("input");inp[k].placeholder=l;return inp[k]});
  modal(el("p","Вы собираетесь сделать выбранную информацию доступной этому человеку. Даже если вы позже закроете доступ, он мог сохранить её или сделать скриншот. Заполните только то, чем хотите поделиться."),...rows,
    el("button","Да, я хочу раскрыться",async()=>{
      const d={};Object.keys(LBL).forEach(k=>{const v=inp[k].value.trim();if(v)d[k]=k==="age"?(+v||null):v});
      if(!Object.keys(d).length)return alert("Заполните хотя бы одно поле");
      const e1=await sb.from("profile_private").upsert({user_id:me.id,...d});if(e1.error)return alert(e1.error.message);
      const e2=await sb.from("reveals").upsert({owner:me.id,viewer:uid,fields:Object.keys(d),status:"pending"});
      alert(e2.error?e2.error.message:"Запрос отправлен. Данные станут видны после согласия.");close()}));
}
async function inbox(){
  const [d,r]=await Promise.all([sb.from("dialogs").select("*").neq("status","declined"),sb.from("reveals").select("*").eq("viewer",me.id).eq("status","pending")]);
  const ds=d.data||[],rs=r.data||[];await loadProfiles([...ds.flatMap(x=>[x.a,x.b]),...rs.map(x=>x.owner)]);
  const nm=id=>(profiles[id]||{}).avatar+" "+(profiles[id]||{}).nickname;const n=[el("h3","Сообщения")];
  rs.forEach(x=>n.push(el("div",nm(x.owner)+" хочет поделиться с вами личной информацией"),el("button","Принять",()=>respR(x.owner,true)),el("button","Отклонить",()=>respR(x.owner,false))));
  ds.forEach(x=>{const o=x.a===me.id?x.b:x.a;
    if(x.status==="pending")x.b===me.id?n.push(el("div",nm(o)+" предлагает общение"),el("button","Принять",()=>respD(x.id,true)),el("button","Отклонить",()=>respD(x.id,false))):n.push(el("div",nm(o)+" — ждёт ответа"));
    else n.push(el("button","💬 "+nm(o),()=>{close();openDm(x.id,o)}))});
  if(n.length===1)n.push(el("p","Пока пусто"));modal(...n);
}
const respR=async(o,ok)=>{await sb.rpc("respond_reveal",{o,ok});inbox()};
const respD=async(id,ok)=>{await sb.rpc("respond_dialog",{d:id,ok});inbox()};
async function openDm(id,o){
  window.dmId=id;show("chat");$("#back").hidden=false;await loadProfiles([o]);
  $("#title").textContent="💬 "+profiles[o].avatar+" "+profiles[o].nickname+" #"+o.slice(0,4);
  $("#msgs").replaceChildren(el("button","👤 Профиль собеседника",()=>card(o)));
  const draw=m=>{const d=el("div",m.body==="📷"&&m.image_url?"":m.body);if(m.image_url&&m.image_url.startsWith(CONFIG.SUPABASE_URL+"/storage/")){const i=new Image();i.src=m.image_url;i.className="ph";d.prepend(i)}d.className="m"+(m.user_id===me.id?" me":"");$("#msgs").append(d);$("#msgs").scrollTop=1e9};
  const {data}=await sb.from("dm_messages").select("*").eq("dialog_id",id).order("created_at").limit(200);(data||[]).forEach(draw);
  if(dch)sb.removeChannel(dch);
  dch=sb.channel("dm-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"dm_messages",filter:"dialog_id=eq."+id},p=>draw(p.new)).subscribe();
}
async function dmSend(){const body=$("#text").value.trim();if(!body)return;$("#text").value="";
  const {error}=await sb.from("dm_messages").insert({dialog_id:dmId,body});if(error){alert(error.message);$("#text").value=body}}
async function myProfile(){
  const p=profiles[me.id],nick=el("input");nick.value=p.avatar+" "+p.nickname;
  const {data}=await sb.from("reveals").select("viewer,status").eq("owner",me.id);await loadProfiles((data||[]).map(x=>x.viewer));
  const n=[el("h3","Мой профиль"),el("p","Маска дня: смените имя и аватар, внутренний ID останется прежним."),nick,
    el("button","Сохранить маску",async()=>{const [avatar,nickname]=split(nick.value.trim());const {data:u,error}=await sb.from("profiles").update({avatar,nickname}).eq("id",me.id).select().single();if(error)return alert(error.message);profiles[me.id]=u;close()})];
  if(data&&data.length)n.push(el("h4","Кому я открыл данные (отзыв не удаляет то, что уже сохранено)"));
  (data||[]).forEach(x=>n.push(el("button","Отозвать: "+(profiles[x.viewer]||{}).nickname+" ("+x.status+")",async()=>{await sb.from("reveals").delete().eq("owner",me.id).eq("viewer",x.viewer);myProfile()})));
  n.push(el("button","📧 Привязать e-mail для восстановления",linkEmail));n.push(el("button","Удалить аккаунт",async()=>{if(confirm("Удалить аккаунт и все сообщения?")){await sb.rpc("delete_account");await sb.auth.signOut();location.reload()}}));
  modal(...n);
}
async function admin(role){
  const {data}=await sb.from("reports").select("id,reason,messages(id,body,user_id)").order("id",{ascending:false}).limit(30);
  const n=[el("h3","Жалобы")];
  (data||[]).forEach(r=>{const m=r.messages;n.push(el("div","«"+(m?m.body:"удалено")+"» — "+(r.reason||"")));
    if(m){n.push(el("button","Удалить сообщение",async()=>{await sb.from("messages").delete().eq("id",m.id);admin(role)}),
      el("button","Забанить автора",async()=>{await sb.rpc("ban_user",{u:m.user_id});alert("Готово")}))}
    n.push(el("button","Закрыть жалобу",async()=>{await sb.from("reports").delete().eq("id",r.id);admin(role)}))});
  if(role==="admin")n.push(el("button","🏖 Комнаты",roomsAdmin),el("button","🐢 Медленный режим",slowMode));if(role==="admin")n.push(el("button","Задать вопрос дня",async()=>{const v=prompt("Вопрос дня");if(v!==null)await sb.from("settings").upsert({key:"qotd",value:v})}));
  modal(...n);
}
