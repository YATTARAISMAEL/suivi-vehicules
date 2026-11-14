import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

{ const st=document.createElement("style"); st.textContent="nav button{position:relative}nav button[data-badge]:not([data-badge=\"\"])::after{content:attr(data-badge);position:absolute;top:2px;right:calc(50% - 22px);background:var(--out);color:#fff;font-size:10px;font-weight:800;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 4px}"; document.head.appendChild(st); }
const fbApp = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(fbApp);
const fs = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const CATS = ["Carburant","Entretien / vidange","Réparation","Pneus","Assurance","Visite technique","Chauffeur","Lavage","Amende / taxe","Autre"];
const S = { vehicules:[], entrees:[], depenses:[] };
let canWrite = true, view = "bilan";
const now = new Date();
let month = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0");

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fcfa = n => new Intl.NumberFormat("fr-FR").format(Math.round(n||0)) + " F";
const today = () => new Date().toISOString().slice(0,10);
const fdate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "";
const vName = id => (S.vehicules.find(v=>v.id===id)||{}).nom || "Véhicule supprimé";
const days = (a,b) => (a&&b) ? Math.max(1, Math.round((new Date(b)-new Date(a))/864e5)+1) : 0;
function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("on"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("on"),2600); }

/* ---------- Month ---------- */
function shiftMonth(d){ let [y,m]=month.split("-").map(Number); m+=d; if(m<1){m=12;y--} if(m>12){m=1;y++} month=y+"-"+String(m).padStart(2,"0"); render(); }
$("mPrev").onclick=()=>shiftMonth(-1); $("mNext").onclick=()=>shiftMonth(1);
const inMonth = d => (d||"").slice(0,7) === month;

/* ---------- Nav ---------- */
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{
  view=b.dataset.v;
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
  document.querySelectorAll(".view").forEach(x=>x.classList.toggle("on",x.id==="v-"+view));
  window.scrollTo(0,0); render();
});
$("fab").onclick=()=>{
  if(!canWrite) return toast("Lecture seule");
  if(view==="vehicules") formVeh();
  else if(view==="depenses") formOut();
  else if(view==="entrees") formIn();
  else chooseAdd();
};

/* ---------- Render ---------- */
function vehOptions(sel, withAll){
  return (withAll?`<option value="">Tous les véhicules</option>`:"") +
    S.vehicules.map(v=>`<option value="${esc(v.id)}" ${v.id===sel?"selected":""}>${esc(v.nom)}${v.immat?" · "+esc(v.immat):""}</option>`).join("");
}
function docAlerts(){
  const out=[], t=new Date(today());
  S.vehicules.forEach(v=>{
    [["assurance","Assurance"],["visite","Visite technique"],["vignette","Vignette / patente"]].forEach(([k,l])=>{
      if(!v[k]) return;
      const d=Math.round((new Date(v[k])-t)/864e5);
      if(d<=30) out.push({v, k, l, d, date:v[k]});
    });
  });
  return out.sort((a,b)=>a.d-b.d);
}
const DOCS=[["assurance","Assurance"],["visite","Visite technique"],["vignette","Vignette / patente"]];
function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,""); }
function calLink(v,k,l){
  const due=new Date(v[k]+"T00:00:00"), t=new Date(today()+"T00:00:00");
  let r=new Date(due); r.setDate(r.getDate()-7); if(r<t) r=t;
  const r2=new Date(r); r2.setDate(r2.getDate()+1);
  const txt=`🚗 Renouveler ${l.toLowerCase()} – ${v.nom||""}${v.immat?" ("+v.immat+")":""}`;
  const det=`${l} de ${v.nom||"ce véhicule"} expire le ${due.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}.`;
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(txt)+"&dates="+ymd(r)+"/"+ymd(r2)+"&details="+encodeURIComponent(det);
}
function notifState(){ try{ return ("Notification" in window) ? Notification.permission : "na"; }catch(e){ return "na"; } }
async function enableNotif(){
  try{ const p=await Notification.requestPermission(); if(p==="granted"){ toast("Notifications activées ✓"); notifyAlerts(true); } else toast("Notifications refusées"); }catch(e){ toast("Notifications non disponibles"); }
  render();
}
let notifiedOnce=false;
async function notifyAlerts(force){
  if(notifState()!=="granted" || (notifiedOnce && !force)) return;
  const al=docAlerts().filter(a=>a.d<=30); if(!al.length) return;
  let seen={}; try{ seen=JSON.parse(localStorage.getItem("notifSeen")||"{}"); }catch(e){}
  const day=today(), reg=await navigator.serviceWorker?.getRegistration?.().catch(()=>null);
  notifiedOnce=true;
  for(const a of al){
    // une notification par document et par jour, aux paliers J-30, J-15, J-7, J-3, J-1, le jour même et après expiration
    const step=[30,15,7,3,1,0].includes(a.d) || a.d<0 || force;
    const key=a.v.id+"|"+a.k+"|"+a.date;
    if(!step || seen[key]===day) continue;
    const title = a.d<0 ? `⛔ ${a.l} expirée – ${a.v.nom}` : a.d===0 ? `⚠ ${a.l} expire aujourd'hui – ${a.v.nom}` : `⚠ ${a.l} : J-${a.d} – ${a.v.nom}`;
    const body = `Échéance le ${new Date(a.date+"T00:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}. Pense à la renouveler.`;
    try{ if(reg) await reg.showNotification(title,{body, icon:"icon-192.png", badge:"icon-192.png", tag:key}); else new Notification(title,{body, icon:"icon-192.png", tag:key}); seen[key]=day; }catch(e){}
  }
  try{ localStorage.setItem("notifSeen", JSON.stringify(seen)); }catch(e){}
}

function render(){
  $("mLabel").textContent = new Date(month+"-01T00:00:00").toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  $("fab").style.display = canWrite ? "" : "none";
  const ins = S.entrees.filter(e=>inMonth(e.debut)), outs = S.depenses.filter(d=>inMonth(d.date));
  const tIn = ins.reduce((s,e)=>s+(+e.montant||0),0), tOut = outs.reduce((s,d)=>s+(+d.montant||0),0);

  // Bilan
  $("kIn").textContent=fcfa(tIn); $("kOut").textContent=fcfa(tOut); $("kNet").textContent=fcfa(tIn-tOut);
  const nJ = ins.reduce((s,e)=>s+days(e.debut,e.fin),0);
  $("kJours").textContent = ins.length ? `${ins.length} sortie${ins.length>1?"s":""} · ${nJ} jour${nJ>1?"s":""} de location` : "Aucune sortie ce mois";

  const al = docAlerts();
  const ns=notifState();
  const notifBtn = ns==="default" ? `<button class="btn" id="notifBtn" style="margin-top:12px">🔔 Activer les notifications</button>` : ns==="denied" ? `<div class="mut" style="margin-top:10px">Notifications bloquées : autorise-les dans les réglages du téléphone pour cette appli.</div>` : "";
  $("alerts").innerHTML = al.length ? `<div class="card alert"><b>⚠ Documents à renouveler</b>${al.map(a=>`<div class="row sp" style="margin-top:10px"><span class="grow">${esc(a.v.nom)} — ${a.l}<div class="mut">${fdate(a.date)} · <a class="lnk" href="${calLink(a.v,a.k,a.l)}" target="_blank" rel="noopener">📅 Mettre dans l'agenda</a></div></span><span class="tag ${a.d<0?"r":"w"}">${a.d<0?"Expiré":a.d===0?"Aujourd'hui":"J-"+a.d}</span></div>`).join("")}${notifBtn}</div>`
    : (ns==="default" && S.vehicules.some(v=>v.assurance||v.visite||v.vignette)) ? `<div class="card row sp"><span class="grow"><b>Rappels d'échéances</b><div class="mut">Reçois une alerte avant la fin des assurances et visites</div></span><button class="icon-btn" id="notifBtn">🔔 Activer</button></div>` : "";
  if($("notifBtn")) $("notifBtn").onclick=enableNotif;
  const nAl = al.length; document.querySelector('nav [data-v="bilan"]').dataset.badge = nAl||"";

  if(!S.vehicules.length){
    $("perVeh").innerHTML = `<div class="card empty">Commence par ajouter tes véhicules dans l'onglet <b>Véhicules</b>.</div>`;
  } else {
    const rows = S.vehicules.map(v=>{
      const i=ins.filter(e=>e.vehicule===v.id).reduce((s,e)=>s+(+e.montant||0),0);
      const o=outs.filter(d=>d.vehicule===v.id).reduce((s,d)=>s+(+d.montant||0),0);
      const j=ins.filter(e=>e.vehicule===v.id).reduce((s,e)=>s+days(e.debut,e.fin),0);
      return {v,i,o,j};
    }).sort((a,b)=>(b.i-b.o)-(a.i-a.o));
    $("perVeh").innerHTML = rows.map(r=>{
      const tot=r.i+r.o||1;
      return `<div class="card tap" data-veh="${esc(r.v.id)}"><div class="row sp"><div class="grow"><b>${esc(r.v.nom)}</b> <span class="mut">${esc(r.v.immat||"")}</span><div class="mut">${r.j} jour${r.j>1?"s":""} loué${r.j>1?"s":""}</div></div><div style="text-align:right"><div class="amt ${r.i-r.o>=0?"in":"out"}" style="font-weight:800">${fcfa(r.i-r.o)}</div><div class="mut"><span class="in">+${fcfa(r.i)}</span> · <span class="out">−${fcfa(r.o)}</span></div></div></div><div class="bar"><i style="width:${r.i/tot*100}%;background:var(--in)"></i><i style="width:${r.o/tot*100}%;background:var(--out)"></i></div></div>`;
    }).join("");
    document.querySelectorAll("[data-veh]").forEach(el=>el.onclick=()=>{ $("fVehIn").value=el.dataset.veh; document.querySelector('nav [data-v="entrees"]').click(); });
  }

  const byCat={}; outs.forEach(d=>byCat[d.categorie||"Autre"]=(byCat[d.categorie||"Autre"]||0)+(+d.montant||0));
  const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  $("perCat").innerHTML = cats.length ? cats.map(([c,m])=>`<div class="item"><span class="grow">${esc(c)}</span><span class="amt out">${fcfa(m)}</span></div>`).join("") : `<div class="empty" style="padding:8px">Aucune dépense ce mois</div>`;

  // Entrées
  const fi=$("fVehIn").value; $("fVehIn").innerHTML=vehOptions(fi,true); $("fVehIn").value=fi;
  const li = ins.filter(e=>!fi||e.vehicule===fi).sort((a,b)=>(b.debut||"").localeCompare(a.debut||""));
  $("listIn").innerHTML = li.length ? `<div class="row sp" style="margin-bottom:6px"><span class="mut">${li.length} sortie(s)</span><b class="in">${fcfa(li.reduce((s,e)=>s+(+e.montant||0),0))}</b></div>` + li.map(e=>`<div class="item tap" data-in="${esc(e.id)}"><div class="grow"><b>${esc(vName(e.vehicule))}</b>${e.client?` <span class="mut">· ${esc(e.client)}</span>`:""}<div class="mut">Du ${fdate(e.debut)} au ${fdate(e.fin)} · ${days(e.debut,e.fin)} j${e.remise?` · remise ${fcfa(e.remise)}`:""}${e.paye===false?' · <span class="tag w">Non payé</span>':""}</div></div><span class="amt in">+${fcfa(e.montant)}</span></div>`).join("") : `<div class="empty">Aucune entrée ce mois.<br>Touche <b>+</b> pour enregistrer une sortie.</div>`;
  document.querySelectorAll("[data-in]").forEach(el=>el.onclick=()=>formIn(S.entrees.find(x=>x.id===el.dataset.in)));

  // Dépenses
  const fo=$("fVehOut").value; $("fVehOut").innerHTML=vehOptions(fo,true); $("fVehOut").value=fo;
  const lo = outs.filter(d=>!fo||d.vehicule===fo).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  $("listOut").innerHTML = lo.length ? `<div class="row sp" style="margin-bottom:6px"><span class="mut">${lo.length} dépense(s)</span><b class="out">${fcfa(lo.reduce((s,d)=>s+(+d.montant||0),0))}</b></div>` + lo.map(d=>`<div class="item tap" data-out="${esc(d.id)}"><div class="grow"><b>${esc(vName(d.vehicule))}</b> <span class="tag">${esc(d.categorie||"Autre")}</span><div class="mut">${fdate(d.date)}${d.note?" · "+esc(d.note):""}</div></div><span class="amt out">−${fcfa(d.montant)}</span></div>`).join("") : `<div class="empty">Aucune dépense ce mois.<br>Touche <b>+</b> pour en ajouter une.</div>`;
  document.querySelectorAll("[data-out]").forEach(el=>el.onclick=()=>formOut(S.depenses.find(x=>x.id===el.dataset.out)));

  // Véhicules
  $("listVeh").innerHTML = S.vehicules.length ? S.vehicules.slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")).map(v=>{
    const tags=[["assurance","Assur."],["visite","Visite"],["vignette","Vignette"]].filter(([k])=>v[k]).map(([k,l])=>{const d=Math.round((new Date(v[k])-new Date(today()))/864e5);return `<span class="tag ${d<0?"r":d<=30?"w":""}">${l} ${fdate(v[k])}</span>`}).join(" ");
    return `<div class="card"><div class="row sp tap" data-v-ed="${esc(v.id)}"><div class="grow"><b>${esc(v.nom)}</b> <span class="mut">${esc(v.immat||"")}</span><div class="mut">${esc(v.modele||"")}${v.km?" · "+new Intl.NumberFormat("fr-FR").format(v.km)+" km":""}</div></div><span class="mut">Modifier ›</span></div>${amortBlock(v)}${tags?`<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${tags}</div><div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">${DOCS.filter(([k])=>v[k]).map(([k,l])=>`<a class="lnk" href="${calLink(v,k,l)}" target="_blank" rel="noopener">📅 Rappel ${l.split(" ")[0].toLowerCase()}</a>`).join("")}</div>`:""}<div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">${v.pos?`<a class="lnk" href="https://www.google.com/maps?q=${v.pos.lat},${v.pos.lng}" target="_blank" rel="noopener">📍 Dernière position</a><span class="mut">${esc(new Date(v.pos.t).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}))}</span>`:""}${/^https?:\/\//.test(v.gps||"")?`<a class="lnk" href="${esc(v.gps)}" target="_blank" rel="noopener">🛰 Traceur GPS</a>`:""}<button class="icon-btn" data-pos="${esc(v.id)}">Enregistrer ma position</button></div></div>`;
  }).join("") : `<div class="card empty">Aucun véhicule. Touche <b>+</b> pour ajouter le premier.</div>`;
  document.querySelectorAll("[data-pos]").forEach(el=>el.onclick=()=>savePos(el.dataset.pos, el));
  document.querySelectorAll("[data-v-ed]").forEach(el=>el.onclick=()=>formVeh(S.vehicules.find(x=>x.id===el.dataset.vEd)));
}
$("fVehIn").onchange=render; $("fVehOut").onchange=render;

/* ---------- Amortissement ---------- */
function amort(v){
  const ins=S.entrees.filter(e=>e.vehicule===v.id), outs=S.depenses.filter(d=>d.vehicule===v.id);
  const tIn=ins.reduce((s,e)=>s+(+e.montant||0),0), tOut=outs.reduce((s,d)=>s+(+d.montant||0),0);
  const benef=tIn-tOut, prix=+v.prixAchat||0;
  const dates=[...ins.map(e=>e.debut),...outs.map(d=>d.date)].filter(Boolean).sort();
  const start=v.dateAchat||dates[0];
  let mois=0; if(start){ const a=new Date(start), b=new Date(today()); mois=Math.max(1,(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth())+1); }
  const parMois = mois ? benef/mois : 0;
  const reste=Math.max(0,prix-benef);
  return { tIn,tOut,benef,prix,reste,pct: prix?Math.min(100,Math.max(0,benef/prix*100)):0, parMois, moisRestants: (reste>0&&parMois>0)?Math.ceil(reste/parMois):null, jours: ins.reduce((s,e)=>s+days(e.debut,e.fin),0) };
}
function amortBlock(v){
  if(!(+v.prixAchat)) return `<div class="mut" style="margin-top:8px">Ajoute le prix d'achat (Modifier) pour suivre l'amortissement.</div>`;
  const a=amort(v), ok=a.reste===0;
  return `<div style="margin-top:12px;padding:12px;border-radius:12px;background:${ok?"var(--pri2)":"#f7f5ef"}">
    <div class="row sp"><b>${ok?"✅ Véhicule amorti":"Amortissement"}</b><b class="${ok?"in":""}">${Math.round(a.pct)} %</b></div>
    <div class="bar" style="height:8px"><i style="width:${a.pct}%;background:var(--in)"></i></div>
    <div class="row sp" style="margin-top:8px"><span class="mut">Prix d'achat</span><span>${fcfa(a.prix)}</span></div>
    <div class="row sp"><span class="mut">Total entrées</span><span class="in">+${fcfa(a.tIn)}</span></div>
    <div class="row sp"><span class="mut">Total dépenses</span><span class="out">−${fcfa(a.tOut)}</span></div>
    <div class="row sp"><span class="mut">Bénéfice cumulé</span><b class="${a.benef>=0?"in":"out"}">${fcfa(a.benef)}</b></div>
    ${ok?`<div class="row sp"><span class="mut">Gain au-delà du prix d'achat</span><b class="in">${fcfa(a.benef-a.prix)}</b></div>`:`<div class="row sp"><span class="mut">Reste à amortir</span><b class="out">${fcfa(a.reste)}</b></div>`}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
      <div class="row sp"><b>Prix de vente minimum</b><b style="font-size:17px">${fcfa(a.reste)}</b></div>
      <div class="mut" style="margin-top:2px">${ok?"La voiture a déjà remboursé son prix : tout montant de vente est du bénéfice.":"En dessous de ce prix, tu perds de l'argent sur cette voiture. Au-dessus, tu es gagnant."}</div>
      ${!ok&&a.moisRestants?`<div class="mut" style="margin-top:4px">Au rythme actuel (${fcfa(a.parMois)}/mois), amortie dans environ <b>${a.moisRestants} mois</b>.</div>`:""}
      ${!ok&&a.benef<=0&&(a.tIn||a.tOut)?`<div class="mut" style="margin-top:4px;color:var(--out)">Pour l'instant, les dépenses dépassent les entrées.</div>`:""}
    </div></div>`;
}

/* ---------- Sheets / forms ---------- */
function openSheet(html){ $("sheet").innerHTML=html; $("sheetBg").classList.add("on"); }
function closeSheet(){ $("sheetBg").classList.remove("on"); }
$("sheetBg").onclick=e=>{ if(e.target.id==="sheetBg") closeSheet(); };

function chooseAdd(){
  openSheet(`<h3>Ajouter</h3><div class="mut" style="margin-bottom:14px">Que veux-tu enregistrer ?</div>
  <div style="display:grid;gap:10px"><button class="btn" id="cIn">+ Une entrée (sortie / location)</button><button class="btn ghost" id="cOut">− Une dépense</button><button class="btn ghost" id="cVeh">Un véhicule</button></div>`);
  $("cIn").onclick=()=>formIn(); $("cOut").onclick=()=>formOut(); $("cVeh").onclick=()=>formVeh();
}
function needVeh(){ if(!S.vehicules.length){ toast("Ajoute d'abord un véhicule"); formVeh(); return true;} return false; }

function footer(isEdit){ return `<div class="actions">${isEdit&&canWrite?`<button class="btn danger" id="fDel" type="button">Supprimer</button>`:""}<button class="btn" id="fSave" type="submit">Enregistrer</button></div><button class="btn ghost" type="button" id="fCancel" style="margin-top:10px">Annuler</button>`; }

function formIn(e){
  if(needVeh()) return;
  e = e || {};
  openSheet(`<form id="f"><h3>${e.id?"Modifier l'entrée":"Nouvelle entrée"}</h3><div class="mut">Le véhicule est sorti de telle date à telle date, pour tel montant.</div>
  <label>Véhicule</label><select name="vehicule" required>${vehOptions(e.vehicule||$("fVehIn").value||S.vehicules[0]?.id)}</select>
  <div class="grid2"><div><label>Sorti le</label><input type="date" name="debut" required value="${esc(e.debut||today())}"></div><div><label>Rentré le</label><input type="date" name="fin" required value="${esc(e.fin||e.debut||today())}"></div></div>
  <div class="grid2"><div><label>Prix par jour (FCFA)</label><input type="number" inputmode="numeric" name="tarif" min="0" value="${esc(e.tarif??"")}" placeholder="ex : 25000"></div><div><label>Remise (FCFA)</label><input type="number" inputmode="numeric" name="remise" min="0" value="${esc(e.remise??"")}" placeholder="0"></div></div>
  <div class="mut" id="calcLine" style="margin-top:8px"></div>
  <label>Montant reçu (FCFA)</label><input type="number" inputmode="numeric" name="montant" required min="0" value="${esc(e.montant??"")}" placeholder="calculé automatiquement">
  <label>Client / chauffeur</label><input name="client" value="${esc(e.client||"")}" placeholder="facultatif">
  <label>Payé ?</label><select name="paye"><option value="1">Oui, payé</option><option value="0" ${e.paye===false?"selected":""}>Non, reste à payer</option></select>
  <label>Note</label><textarea name="note" placeholder="facultatif">${esc(e.note||"")}</textarea>
  ${footer(!!e.id)}</form>`);
  const F=$("f"), q=n=>F.elements[n];
  const tarifOf=id=>(S.vehicules.find(v=>v.id===id)||{}).tarifJour;
  if(!e.id && q("tarif").value==="" && tarifOf(q("vehicule").value)) q("tarif").value=tarifOf(q("vehicule").value);
  let manual = !!e.id && e.tarif==null; // ancienne entrée saisie à la main
  const recalc=()=>{
    const j=days(q("debut").value,q("fin").value), t=+q("tarif").value||0, r=+q("remise").value||0;
    if(t && j){
      const brut=j*t, net=Math.max(0,brut-r);
      $("calcLine").innerHTML=`${j} jour${j>1?"s":""} × ${fcfa(t)} = <b>${fcfa(brut)}</b>${r?` − remise ${fcfa(r)} = <b class="in">${fcfa(net)}</b>`:""}`;
      if(!manual) q("montant").value=net;
    } else $("calcLine").textContent = t ? "" : "Mets le prix par jour pour calculer le montant automatiquement.";
  };
  q("vehicule").onchange=()=>{ const t=tarifOf(q("vehicule").value); if(t) q("tarif").value=t; manual=false; recalc(); };
  ["debut","fin","tarif","remise"].forEach(n=>q(n).oninput=()=>{ manual=false; recalc(); });
  q("montant").oninput=()=>{ manual=true; };
  recalc();
  bindForm("entrees", e, fd=>{
    if(fd.fin < fd.debut) { toast("La date de retour est avant la date de sortie"); return null; }
    return { vehicule:fd.vehicule, debut:fd.debut, fin:fd.fin, tarif:fd.tarif?+fd.tarif:null, remise:+fd.remise||0, montant:+fd.montant||0, client:fd.client.trim(), paye:fd.paye==="1", note:fd.note.trim() };
  });
}
function formOut(d){
  if(needVeh()) return;
  d = d || {};
  openSheet(`<form id="f"><h3>${d.id?"Modifier la dépense":"Nouvelle dépense"}</h3>
  <label>Véhicule</label><select name="vehicule" required>${vehOptions(d.vehicule||$("fVehOut").value||S.vehicules[0]?.id)}</select>
  <div class="grid2"><div><label>Date</label><input type="date" name="date" required value="${esc(d.date||today())}"></div><div><label>Montant (FCFA)</label><input type="number" inputmode="numeric" name="montant" required min="0" value="${esc(d.montant??"")}" placeholder="ex : 20000"></div></div>
  <label>Catégorie</label><select name="categorie">${CATS.map(c=>`<option ${c===(d.categorie||"Carburant")?"selected":""}>${c}</option>`).join("")}</select>
  <label>Détail</label><textarea name="note" placeholder="ex : vidange + filtre à huile">${esc(d.note||"")}</textarea>
  ${footer(!!d.id)}</form>`);
  bindForm("depenses", d, fd=>({ vehicule:fd.vehicule, date:fd.date, montant:+fd.montant||0, categorie:fd.categorie, note:fd.note.trim() }));
}
function formVeh(v){
  v = v || {};
  openSheet(`<form id="f"><h3>${v.id?"Modifier le véhicule":"Nouveau véhicule"}</h3>
  <div class="grid2"><div><label>Nom</label><input name="nom" required value="${esc(v.nom||"")}" placeholder="ex : Voiture A"></div><div><label>Immatriculation</label><input name="immat" value="${esc(v.immat||"")}" placeholder="ex : 1234 AB 01"></div></div>
  <div class="grid2"><div><label>Marque / modèle</label><input name="modele" value="${esc(v.modele||"")}" placeholder="ex : Toyota Corolla"></div><div><label>Kilométrage</label><input type="number" inputmode="numeric" name="km" value="${esc(v.km??"")}"></div></div>
  <div class="grid2"><div><label>Fin assurance</label><input type="date" name="assurance" value="${esc(v.assurance||"")}"></div><div><label>Fin visite technique</label><input type="date" name="visite" value="${esc(v.visite||"")}"></div></div>
  <label>Fin vignette / patente</label><input type="date" name="vignette" value="${esc(v.vignette||"")}">
  <div class="grid2"><div><label>Prix d'achat (FCFA)</label><input type="number" inputmode="numeric" name="prixAchat" min="0" value="${esc(v.prixAchat??"")}" placeholder="ex : 6000000"></div><div><label>Date d'achat</label><input type="date" name="dateAchat" value="${esc(v.dateAchat||"")}"></div></div>
  <label>Prix de location par jour (FCFA)</label><input type="number" inputmode="numeric" name="tarifJour" min="0" value="${esc(v.tarifJour??"")}" placeholder="ex : 25000">
  <label>Lien de suivi GPS (appli du traceur)</label><input type="url" name="gps" value="${esc(v.gps||"")}" placeholder="https://…">
  ${footer(!!v.id)}</form>`);
  bindForm("vehicules", v, fd=>({ nom:fd.nom.trim(), immat:fd.immat.trim(), modele:fd.modele.trim(), km:fd.km?+fd.km:null, assurance:fd.assurance, visite:fd.visite, vignette:fd.vignette, gps:fd.gps.trim(), prixAchat:fd.prixAchat?+fd.prixAchat:null, dateAchat:fd.dateAchat, tarifJour:fd.tarifJour?+fd.tarifJour:null }), v.id ? ()=> {
    const n = S.entrees.filter(e=>e.vehicule===v.id).length + S.depenses.filter(d=>d.vehicule===v.id).length;
    return n ? `Ce véhicule a ${n} opération(s) enregistrée(s). Elles resteront mais afficheront « Véhicule supprimé ».` : "";
  } : null);
}

function bindForm(col, item, build, delWarn){
  $("fCancel").onclick=closeSheet;
  const f=$("f");
  f.onsubmit=async ev=>{
    ev.preventDefault();
    const fd=Object.fromEntries(new FormData(f).entries());
    const data=build(fd); if(!data) return;
    data.maj = new Date().toISOString();
    const btn=$("fSave"); btn.disabled=true; btn.textContent="Enregistrement…";
    const p = item.id ? setDoc(doc(fs,col,item.id), {...stripId(item), ...data}) : addDoc(collection(fs,col), {...data, cree:data.maj});
    p.catch(handleErr);
    closeSheet(); toast(navigator.onLine ? "Enregistré ✓" : "Enregistré (sera envoyé au retour du réseau)");
  };
  const del=$("fDel");
  if(del) del.onclick=()=>{
    const w = delWarn ? delWarn() : "";
    const box=document.createElement("div");
    box.innerHTML=`<div class="card alert" style="margin-top:12px"><b>Supprimer définitivement ?</b>${w?`<div class="mut" style="margin-top:4px">${esc(w)}</div>`:""}<div class="actions"><button type="button" class="btn ghost" id="dNo">Non</button><button type="button" class="btn danger" id="dYes">Oui, supprimer</button></div></div>`;
    f.appendChild(box); del.disabled=true;
    $("dNo").onclick=()=>{ box.remove(); del.disabled=false; };
    $("dYes").onclick=()=>{ deleteDoc(doc(fs,col,item.id)).catch(handleErr); closeSheet(); toast("Supprimé"); };
  };
}
function stripId(o){ const c={...o}; delete c.id; return c; }
function handleErr(err){
  const c=err&&err.code;
  if(c==="permission-denied") toast("Accès refusé : ce compte n'est pas autorisé");
  else toast("Échec de l'enregistrement, réessaie");
  console.error(err);
}

/* ---------- GPS ---------- */
function savePos(id, btn){
  if(!navigator.geolocation) return toast("GPS non disponible sur ce téléphone");
  btn.disabled=true; btn.textContent="Localisation…";
  navigator.geolocation.getCurrentPosition(p=>{
    updateDoc(doc(fs,"vehicules",id), { pos:{ lat:+p.coords.latitude.toFixed(6), lng:+p.coords.longitude.toFixed(6), t:new Date().toISOString() } }).catch(handleErr);
    toast("Position enregistrée ✓");
  }, e=>{ toast(e.code===1 ? "Autorise la localisation pour l'appli" : "Position introuvable, réessaie dehors"); render(); }, { enableHighAccuracy:true, timeout:20000 });
}

/* ---------- Install (PWA) ---------- */
let deferred=null;
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); deferred=e; $("installBar").style.display="flex"; });
$("installBtn").onclick=async()=>{ if(!deferred) return; deferred.prompt(); await deferred.userChoice; deferred=null; $("installBar").style.display="none"; };
window.addEventListener("appinstalled", ()=>{ $("installBar").style.display="none"; });
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});

/* ---------- Auth + data ---------- */
let unsubs=[];
function startData(){
  $("status").textContent="Chargement…";
  const ready={};
  ["vehicules","entrees","depenses"].forEach(col=>{
    unsubs.push(onSnapshot(collection(fs,col), { includeMetadataChanges:true }, snap=>{
      S[col]=snap.docs.map(d=>({id:d.id, ...d.data()}));
      ready[col]=!snap.metadata.fromCache;
      const pend = snap.metadata.hasPendingWrites;
      $("status").textContent = !navigator.onLine ? "Hors ligne — les ajouts seront envoyés plus tard"
        : (ready.vehicules&&ready.entrees&&ready.depenses) ? (pend?"Envoi en cours…":"Synchronisé ✓") : "Synchronisation…";
      render();
      if(ready.vehicules && !snap.metadata.fromCache) notifyAlerts();
    }, err=>{
      $("status").textContent = err.code==="permission-denied" ? "Compte non autorisé" : "Erreur de synchronisation";
    }));
  });
}
function stopData(){ unsubs.forEach(u=>u()); unsubs=[]; S.vehicules=[];S.entrees=[];S.depenses=[]; }
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible"){ notifiedOnce=false; notifyAlerts(); } });
window.addEventListener("online", ()=>{ $("status").textContent="Synchronisation…"; });
window.addEventListener("offline", ()=>{ $("status").textContent="Hors ligne — les ajouts seront envoyés plus tard"; });

setPersistence(auth, browserLocalPersistence).catch(()=>{});
onAuthStateChanged(auth, u=>{
  if(u){ $("login").classList.remove("on"); startData(); }
  else { stopData(); $("login").classList.add("on"); }
  render();
});
$("loginForm").onsubmit=async e=>{
  e.preventDefault();
  const f=new FormData(e.target), b=$("loginBtn");
  b.disabled=true; b.textContent="Connexion…"; $("loginErr").textContent="";
  try{ await signInWithEmailAndPassword(auth, f.get("email").trim(), f.get("pass")); }
  catch(err){ $("loginErr").textContent = (err.code||"").includes("network") ? "Pas de connexion internet" : "E-mail ou mot de passe incorrect"; }
  b.disabled=false; b.textContent="Se connecter";
};
$("logoutBtn").onclick=()=>signOut(auth);
render();
