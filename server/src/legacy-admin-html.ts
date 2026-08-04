// The pre-rebuild single-page portal, kept verbatim at /admin/legacy while
// sections migrate into the SPA one at a time — so a break can be told
// apart from pre-existing behavior. Delete once every section has moved.
export const LEGACY_ADMIN_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snapt Admin</title><style>
body{font-family:system-ui;margin:0;background:#FAFAFA;color:#1A1A1A}
header{background:#1A1A1A;color:#FFB800;padding:14px 20px;font-weight:800;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header input{border:none;border-radius:8px;padding:8px 10px;min-width:220px}
main{padding:16px;max-width:900px;margin:0 auto}
h2{font-size:15px;margin:22px 0 8px}
.card{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.07);font-size:13px}
.sos{border-left:5px solid #EB5757}
.tag{display:inline-block;background:#FFF4D6;color:#8A6800;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:8px}
button{background:#FFB800;border:none;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer;margin:4px 4px 0 0}
button.ghost{background:#eee}
pre{white-space:pre-wrap;font-size:11px;color:#555;margin:6px 0 0}
</style></head><body>
<header>Snapt Admin
<input id="em" placeholder="Admin email" />
<input id="pw" placeholder="Password" type="password" />
<button id="lg" onclick="login()">Sign in</button>
<span id="lok" style="color:#5FD48F;font-weight:700"></span>
<span id="lerr" style="color:#FFD98A;font-size:12px;font-weight:600;max-width:320px"></span></header>
<main>
<div id="stats" style="display:flex;gap:8px;flex-wrap:wrap"></div>
<h2>Fee & config settings</h2><div id="cfg"></div>
<h2>Manual dispatch — unassigned bookings</h2><div id="unassigned"></div>
<h2>Alerts (SOS first)</h2><div id="alerts"></div>
<h2>Open disputes</h2><div id="disputes"></div>
<h2>Creator applications</h2><div id="apps"></div>
<h2>Legal & policy documents</h2><div id="pol"></div>
<h2>Pending payouts (manual fulfillment)</h2><div id="payouts"></div>
<h2>Moderation queue (severity first)</h2><div id="mod"></div>
</main><script>
const $=id=>document.getElementById(id);
const H=()=>({'Authorization':'Bearer '+(localStorage.jwt||''),'x-admin-token':localStorage.tok||'','Content-Type':'application/json'});
async function login(){
 const btn=$('lg');if(btn.disabled)return;
 btn.disabled=true;btn.textContent='Signing in…';
 $('lerr').textContent='This can take up to a minute if the server is waking up.';
 try{
  const r=await fetch('/v1/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('em').value,password:$('pw').value})});
  let d;try{d=await r.json()}catch(e){throw new Error('Server responded '+r.status+' while starting up — try again in ~30 seconds.')}
  if(!d.access_token)throw new Error(d.error||'Login failed');
  localStorage.jwt=d.access_token;
  $('lerr').textContent='';$('em').style.display='none';$('pw').style.display='none';btn.style.display='none';
  $('lok').textContent='Signed in';
  load();
 }catch(e){
  $('lerr').textContent=(e instanceof TypeError)?'Can\\\'t reach the server — it may be waking up. Try again in ~30 seconds.':e.message;
 }finally{
  if(btn.style.display!=='none'){btn.disabled=false;btn.textContent='Sign in'}
 }
}
async function j(u,o){const r=await fetch(u,Object.assign({headers:H()},o));if(r.status===401||r.status===403){sessionExpired();throw new Error('session expired')}return r.json()}
function sessionExpired(){localStorage.removeItem('jwt');$('em').style.display='';$('pw').style.display='';const b=$('lg');b.style.display='';b.disabled=false;b.textContent='Sign in';$('lok').textContent='';$('lerr').textContent='Session expired — sign in again.'}
function signedInUi(){$('em').style.display='none';$('pw').style.display='none';$('lg').style.display='none';$('lerr').textContent='';$('lok').textContent='Signed in'}
async function load(){
 const st=await j('/v1/admin/analytics');
 signedInUi();
 if(st.bookings){$('stats').innerHTML=[['Pending',st.bookings.pending],['Confirmed',st.bookings.confirmed],['Completed',st.bookings.completed],['Disputed',st.bookings.disputed],['GMV $',st.money.charged_usd],['Refunded $',st.money.refunded_usd],['Creators',st.creators.approved],['Open disputes',st.open_disputes],['Active strikes',st.active_strikes]].map(x=>'<div class="card" style="flex:1;min-width:90px;text-align:center"><div style="font-size:20px;font-weight:800">'+x[1]+'</div><div style="font-size:11px;color:#777">'+x[0]+'</div></div>').join('')}
 const cfg=await j('/v1/admin/config');
 $('cfg').innerHTML=(cfg.config||[]).map(c=>'<div class="card"><b>'+c.key+'</b> '+(c.confirmed?'':'<span class="tag">UNCONFIRMED</span>')+'<pre>'+c.description+'</pre><input style="width:70%" id="v-'+c.key+'" value=\\''+JSON.stringify(c.value).replace(/'/g,"&#39;")+'\\'/> <button onclick="saveCfg(\\''+c.key+'\\')">Save</button></div>').join('');
 loadPolicies();loadPayouts();loadMod();
 const un=await j('/v1/admin/unassigned');
 $('unassigned').innerHTML=(un.bookings||[]).map(b=>'<div class="card"><span class="tag">'+(b.occasion||b.type)+'</span>'+(b.area||'')+' · '+(b.scheduled_at?new Date(b.scheduled_at).toLocaleString():'remote')+'<br/><input placeholder="creator uuid" id="a-'+b.id+'" style="width:60%"/> <button onclick="assign(\\''+b.id+'\\')">Assign</button></div>').join('')||'<div class="card">Nothing waiting for dispatch.</div>';
 const a=await j('/v1/admin/alerts');
 $('alerts').innerHTML=(a.alerts||[]).map(x=>'<div class="card '+(x.alert_type==='sos'?'sos':'')+'"><span class="tag">'+x.alert_type+'</span>'+new Date(x.created_at).toLocaleString()+'<pre>'+JSON.stringify(x.detail)+'</pre><button onclick="resolveAlert(\\\''+x.id+'\\\')">Resolve</button></div>').join('')||'<div class="card">Queue clear.</div>';
 const d=await j('/v1/admin/disputes');
 $('disputes').innerHTML=(d.disputes||[]).map(x=>'<div class="card"><span class="tag">'+x.category+'</span>'+x.status+' · opened '+new Date(x.created_at).toLocaleString()+'<pre>'+(x.description||'')+'</pre><pre>Evidence: '+(x.dispute_evidence||[]).length+' item(s)</pre><button onclick="resolveDispute(\\\''+x.id+'\\\',true)">Resolve — release payout</button><button class="ghost" onclick="resolveDispute(\\\''+x.id+'\\\',false)">Resolve — withhold</button></div>').join('')||'<div class="card">No open disputes.</div>';
 const p=await j('/v1/admin/applications');
 $('apps').innerHTML=(p.applications||[]).map(x=>'<div class="card"><b>'+x.profiles.full_name+'</b> · '+x.profiles.email+'<pre>'+(x.specialties||[]).join(', ')+' · '+(x.base_area||'')+'</pre><button onclick="approve(\\\''+x.user_id+'\\\')">Approve (bg check passed)</button><button class="ghost" onclick="rejectApp(\\\''+x.user_id+'\\\')">Reject…</button></div>').join('')||'<div class="card">No pending applications.</div>';
}
async function loadMod(){const m=await j('/v1/admin/moderation');
 $('mod').innerHTML=((m.reports||[]).map(r=>'<div class="card '+(r.severity==='critical'?'sos':'')+'"><span class="tag">'+r.severity.toUpperCase()+'</span><span class="tag">'+r.category+'</span>reporter '+r.reporter_id.slice(0,8)+(r.reporter_false_report_count?' <span class="tag" style="background:#B4442E;color:#fff">⚠ '+r.reporter_false_report_count+' overturned report'+(r.reporter_false_report_count>1?'s':'')+'</span>':'')+' → target '+(r.target_user_id||'n/a').slice(0,8)+(r.law_enforcement_referral?' <span class="tag">LE REFERRAL</span>':'')+'<pre>'+(r.details||'')+'</pre>'+(r.target_user_id?'<button class="ghost" onclick="unsuspend(\\''+r.target_user_id+'\\')">Unsuspend target</button>':'')+'<button onclick="modAct(\\''+r.id+'\\',\\'actioned\\')">Action taken</button><button class="ghost" onclick="modAct(\\''+r.id+'\\',\\'dismissed\\')">Dismiss</button> <select id="sv-'+r.id+'"><option>critical</option><option>high</option><option>medium</option><option>low</option></select><button class="ghost" onclick="modTier(\\''+r.id+'\\')">Set tier</button></div>').join(''))+((m.portfolio_pending||[]).map(p=>'<div class="card"><span class="tag">PORTFOLIO</span>'+p.creator_id.slice(0,8)+'<pre>'+(p.caption||'')+'</pre><button onclick="pf(\\''+p.id+'\\',\\'approved\\')">Approve</button><button class="ghost" onclick="pf(\\''+p.id+'\\',\\'rejected\\')">Reject</button></div>').join(''))||'<div class="card">Moderation queue clear.</div>'}
async function unsuspend(uid){const reason=prompt('Reason for lifting suspension (required):');if(!reason)return;await j('/v1/admin/users/'+uid+'/unsuspend',{method:'POST',body:JSON.stringify({reason})});loadMod()}
async function modAct(id,a){await j('/v1/admin/reports/'+id,{method:'POST',body:JSON.stringify({action:a})});loadMod()}
async function modTier(id){await j('/v1/admin/reports/'+id,{method:'POST',body:JSON.stringify({severity:$('sv-'+id).value})});loadMod()}
async function pf(id,d){await j('/v1/admin/portfolio/'+id,{method:'POST',body:JSON.stringify({decision:d})});loadMod()}
async function loadPayouts(){const p=await j('/v1/admin/payout-requests');$('payouts').innerHTML=(p.requests||[]).map(r=>'<div class="card"><b>'+(r.name||r.creator_id)+'</b> · $'+r.total.toFixed(2)+(r.method==='cash'?' <span class="tag">CASH PICKUP</span>':'')+'<div style="font-size:15px;font-weight:800;margin:6px 0">📞 '+(r.phone||'⚠ no phone on file')+'</div><pre>'+(r.payout_details||'⚠ NO PAYOUT DETAILS ON FILE — contact creator')+'</pre>'+(r.admin_note?'<pre>📝 '+r.admin_note+'</pre>':'')+'<input id="pn-'+r.creator_id+'" placeholder="Note (e.g. Arranged Thurs 2pm, ID confirmed)" style="width:70%"/> <button class="ghost" onclick="pNote(\\''+r.creator_id+'\\')">Save note</button><br/><button onclick="fulfill(\\''+r.creator_id+'\\')">Mark paid out</button></div>').join('')||'<div class="card">No pending payout requests.</div>'}
async function pNote(cid){const n=$('pn-'+cid).value;if(!n)return;await j('/v1/admin/payout-requests/note',{method:'POST',body:JSON.stringify({creator_id:cid,note:n})});loadPayouts()}
async function fulfill(cid){await j('/v1/admin/payout-requests/fulfill',{method:'POST',body:JSON.stringify({creator_id:cid})});loadPayouts()}
async function loadPolicies(){const p=await j('/v1/admin/policies');const latest={};(p.policies||[]).forEach(x=>{if(!latest[x.doc_type])latest[x.doc_type]=x});$('pol').innerHTML=Object.values(latest).map(x=>'<div class="card"><b>'+x.doc_type+'</b> v'+x.version+' <span class="tag">'+x.status.toUpperCase()+'</span>'+(x.requires_reconsent?'<span class="tag">RE-CONSENT</span>':'')+(x.published_at?' published '+new Date(x.published_at).toLocaleDateString():'')+'<br/><textarea id="pc-'+x.doc_type+'" rows="3" style="width:98%" placeholder="New version content…"></textarea><br/><label style="font-size:11px"><input type="checkbox" id="pr-'+x.doc_type+'"/> material change (forces re-consent)</label><br/><button onclick="draftPolicy(\\''+x.doc_type+'\\')">Save as draft v'+(x.version+1)+'</button>'+(x.status==='draft'?'<button class="ghost" onclick="publishPolicy(\\''+x.id+'\\')">Publish v'+x.version+'</button>':'')+'</div>').join('')||'<div class="card">No policy documents found.</div>'}
async function draftPolicy(slug){const c=$('pc-'+slug).value;if(!c)return alert('Content required');await j('/v1/admin/policies/'+slug,{method:'POST',body:JSON.stringify({content:c,requires_reconsent:$('pr-'+slug).checked})});loadPolicies()}
async function publishPolicy(id){await j('/v1/admin/policies/'+id+'/publish',{method:'POST'});loadPolicies()}
async function saveCfg(k){try{const v=JSON.parse($('v-'+k).value);await j('/v1/admin/config/'+k,{method:'PUT',body:JSON.stringify({value:v})});load()}catch(e){alert('Invalid JSON')}}
async function assign(id){await j('/v1/admin/bookings/'+id+'/assign',{method:'POST',body:JSON.stringify({creator_id:$('a-'+id).value.trim()})});load()}
async function resolveAlert(id){await j('/v1/admin/alerts/'+id+'/resolve',{method:'POST'});load()}
async function resolveDispute(id,rel){const note=prompt('Resolution note:')||'';await j('/v1/admin/disputes/'+id+'/resolve',{method:'POST',body:JSON.stringify({resolution:note,release_payout:rel})});load()}
async function approve(id){await j('/v1/admin/creators/'+id+'/approve',{method:'POST',body:JSON.stringify({background_check_passed:true})});load()}
async function rejectApp(id){const reason=prompt('Rejection reason (sent to the applicant):');if(!reason)return;await j('/v1/admin/creators/'+id+'/reject',{method:'POST',body:JSON.stringify({reason})});load()}
if(localStorage.jwt||localStorage.tok)load();
</script></body></html>`;
