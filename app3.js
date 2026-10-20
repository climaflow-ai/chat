const EM=["👍","❤️","😂","🔥"];let pres=null,counts={},rx={},tt,lt=0;
const tr=r=>{if(pres&&pres.state==="joined")pres.track({room:r})};
function lobby(){
  if(pres)return;
  pres=sb.channel("online",{config:{presence:{key:me.id}}});
  pres.on("presence",{event:"sync"},()=>{counts={};Object.values(pres.presenceState()).forEach(a=>{const r=a[0]&&a[0].room;if(r)counts[r]=(counts[r]||0)+1});paint()})
   .on("broadcast",{event:"typing"},({payload:p})=>{if(room&&!window.dmId&&p.room===room.id&&p.u!==me.id){$("#typing").textContent=p.n+" печатает…";clearTimeout(tt);tt=setTimeout(()=>$("#typing").textContent="",2500)}})
   .subscribe(s=>{if(s==="SUBSCRIBED")tr(room?room.id:null)});
  sb.channel("rx").on("postgres_changes",{event:"*",schema:"public",table:"reactions"},p=>{
    const r=p.eventType==="DELETE"?p.old:p.new,id=r.message_id;if(!msgById[id])return;
    const a=rx[id]=(rx[id]||[]).filter(x=>!(x.user_id===r.user_id&&x.emoji===r.emoji));if(p.eventType!=="DELETE")a.push(r);drawRx(id)}).subscribe();
}
function paint(){
  document.querySelectorAll(".room").forEach(b=>{let c=b.querySelector(".cnt");if(!c){c=el("small");c.className="cnt";b.append(c)}c.textContent="🟢 "+(counts[b.dataset.id]||0)+" онлайн"});
  if(room&&!window.dmId)$("#title").textContent=`${room.icon} ${room.title} · 🟢${counts[room.id]||0}`;
}
const _or2=openRooms;
openRooms=async function(){await _or2();lobby();tr(null);paint();$("#rooms").firstChild.append(el("button","🎲 Тайный собеседник",secret))};
const _oro=openRoom;
openRoom=async function(r){
  rx={};$("#pinbar").hidden=true;$("#typing").textContent="";await _oro(r);tr(r.id);paint();
  const ids=Object.keys(msgById);if(!ids.length)return;
  const {data}=await sb.from("reactions").select("*").in("message_id",ids);(data||[]).forEach(x=>(rx[x.message_id]=rx[x.message_id]||[]).push(x));ids.forEach(drawRx);
};
const _add=add;add=function(m){_add(m);decorate(m)};
function decorate(m){
  const d=document.getElementById("m"+m.id);if(!d)return;
  if(m.image_url&&m.image_url.startsWith(CONFIG.SUPABASE_URL+"/storage/")){const i=new Image();i.src=m.image_url;i.loading="lazy";i.className="ph";d.insertBefore(i,d.lastChild)}
  if(m.pinned){d.classList.add("pin");$("#pinbar").hidden=false;$("#pinbar").textContent="📌 "+m.body}
  if(["admin","moderator"].includes(window.myRole))d.lastChild.append(el("span",m.pinned?"Открепить":"Закрепить",async()=>{await sb.rpc("pin_message",{m:m.id,p:!m.pinned});openRoom(room)}));
  if(d.lastChild.lastChild&&d.lastChild.lastChild.textContent.match(/Закрепить|Открепить/))d.lastChild.lastChild.className="act";
  const bar=el("div");bar.className="rx";d.append(bar);drawRx(m.id);
}
function drawRx(id){
  const d=document.getElementById("m"+id),bar=d&&d.querySelector(".rx");if(!bar)return;
  bar.replaceChildren(...EM.map(e=>{const n=(rx[id]||[]).filter(r=>r.emoji===e),mine=n.some(r=>r.user_id===me.id);
    const b=el("button",e+(n.length?" "+n.length:""),()=>toggle(id,e,mine));if(mine)b.classList.add("sel");return b}));
}
async function toggle(id,e,mine){
  if(mine)await sb.from("reactions").delete().eq("message_id",id).eq("user_id",me.id).eq("emoji",e);
  else await sb.from("reactions").insert({message_id:id,emoji:e});
}
$("#text").addEventListener("input",()=>{if(room&&!window.dmId&&pres&&pres.state==="joined"&&Date.now()-lt>1500){lt=Date.now();pres.send({type:"broadcast",event:"typing",payload:{room:room.id,u:me.id,n:profiles[me.id].nickname}})}});
$("#file").onchange=async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;
  if(!/^image\/(jpeg|png|webp)$/.test(f.type)||f.size>2e6)return alert("Только JPG, PNG или WebP до 2 МБ");
  const path=`${me.id}/${Date.now()}.${f.type.split("/")[1]}`;
  const u=await sb.storage.from("photos").upload(path,f,{contentType:f.type});if(u.error)return alert(u.error.message);
  const image_url=sb.storage.from("photos").getPublicUrl(path).data.publicUrl,body=$("#text").value.trim()||"📷";$("#text").value="";
  const r=window.dmId?await sb.from("dm_messages").insert({dialog_id:dmId,body,image_url}):await sb.from("messages").insert({room_id:room.id,body,image_url});
  if(r.error)alert(r.error.message);
};
function secret(){modal(el("h3","О чём хотите поговорить?"),...["Дружба","Знакомства","Жизненные истории","Просто поболтать"].map(t=>el("button",t,()=>search(t))))}
async function search(t){
  let stop=false;modal(el("p","Ищем собеседника… Оставайтесь на этой странице (до 2 минут)."));
  dlg.onclose=async()=>{stop=true;dlg.onclose=null;await sb.rpc("cancel_search")};
  for(let i=0;i<40&&!stop;i++){
    const {data,error}=await sb.rpc("find_partner",{t});if(error){alert(error.message);break}
    if(data){dlg.onclose=null;close();const {data:d}=await sb.from("dialogs").select("a,b").eq("id",data).single();return openDm(data,d.a===me.id?d.b:d.a)}
    await new Promise(r=>setTimeout(r,3000));
  }
  if(!stop){dlg.onclose=null;await sb.rpc("cancel_search");modal(el("p","Пока никого нет. Попробуйте позже или зайдите в общую комнату."))}
}
async function roomsAdmin(){
  const {data}=await sb.from("rooms").select("*").order("id");const n=[el("h3","Комнаты")];
  (data||[]).forEach(r=>n.push(el("div",r.icon+" "+r.title),
    el("button","Переименовать",async()=>{const t=prompt("Название",r.title);if(t){await sb.from("rooms").update({title:t}).eq("id",r.id);roomsAdmin()}}),
    el("button","Удалить",async()=>{if(confirm("Удалить комнату и все её сообщения?")){await sb.from("rooms").delete().eq("id",r.id);roomsAdmin()}})));
  n.push(el("button","➕ Новая комната",async()=>{const icon=prompt("Эмодзи","💬"),title=prompt("Название");if(!title)return;await sb.from("rooms").insert({icon,title,descr:prompt("Описание")||""});roomsAdmin()}));
  modal(...n);
}
async function slowMode(){const v=prompt("Пауза между сообщениями, секунд (2 — обычный режим)","10");if(v!==null)await sb.from("settings").upsert({key:"slow",value:String(Math.max(2,+v||2))})}
async function linkEmail(){const email=prompt("E-mail для восстановления профиля");if(!email)return;const {error}=await sb.auth.updateUser({email},{emailRedirectTo:location.href});alert(error?error.message:"Мы отправили письмо: подтвердите адрес по ссылке.")}
$("#login").append(el("button","Уже есть профиль? Восстановить по e-mail",async()=>{
  const email=prompt("Ваш e-mail");if(!email)return;
  const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.href}});
  alert(error?error.message:"Письмо со ссылкой для входа отправлено.");
}));
