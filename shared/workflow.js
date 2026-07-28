/* =========================================================
   SUNIVERSE 공유 워크플로우 모듈 (co_* 코어 기반)
   ⚠ 홈쇼핑·글로벌소싱 콘솔이 같은 파일을 씁니다. 콘솔별로 복사하지 마세요.
   호스팅: https://ibr-homeshopping-console.netlify.app/shared/workflow.js

   사용법 (각 콘솔 1회 호출):
     SuniverseWF.mount({
       el: document.getElementById('v-workflow'),   // 그릴 위치
       sb: supabaseClient,                          // 로그인된 supabase-js v2 클라이언트
       tenantId: '68ae6fae-...',
       myTeam: 'homeshopping',                      // 또는 'global_sourcing'
       myLabel: '홈쇼핑(우리)',                      // 내 발신 표기
       brandLoader: async () => [{id,name}, ...],   // 새 스레드용 브랜드 목록
       partyKinds: ['internal_team','homeshopping','agency'],  // 기본 노출 거래처 유형
       height: 'calc(100vh - 132px)',
       onCount: n => {}                             // 미회신 합계(사이드바 배지용, 선택)
     });
   ========================================================= */
(function (global) {
  'use strict';
  var CSS_URL = 'https://ibr-homeshopping-console.netlify.app/shared/workflow.css';

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
  function won(n){return Math.round(Number(n)||0).toLocaleString('ko-KR');}
  function rel(ts){var d=new Date(ts),m=Math.floor((Date.now()-d.getTime())/60000);
    if(m<1)return '방금';if(m<60)return m+'분 전';var h=Math.floor(m/60);if(h<24)return h+'시간 전';
    var dd=Math.floor(h/24);return dd<8?dd+'일 전':d.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'});}
  function ensureCss(){if(document.querySelector('link[data-suwf]'))return;
    var l=document.createElement('link');l.rel='stylesheet';l.href=CSS_URL;l.setAttribute('data-suwf','1');document.head.appendChild(l);}

  var KIND_BADGE={request:['요청','#F59E0B'],reply:['회신','#3B82F6'],doc:['자료','#0D9488'],note:['메모','#94A3B8']};
  var KIND_LABEL={internal_team:'자사',homeshopping:'홈사',agency:'대행사',brand_supplier:'공급사',customs:'관세사',forwarder:'포워더',distributor:'판매처'};
  var HS_KINDS=['internal_team','homeshopping','agency'];

  function flowFor(party){var k=(party||{}).kind;
    if(k==='internal_team')return 'gs_handoff';
    if(k==='homeshopping'||k==='agency')return 'hs_native';
    return 'gs_import';}
  function pairKey(brandId,party,myTeam){
    if((party||{}).kind==='internal_team'){var other=party.team_key||(myTeam==='homeshopping'?'global_sourcing':'homeshopping');
      var a=[myTeam,other].sort();return 'brand:'+brandId+'|team:'+a[0]+'+'+a[1];}
    return 'brand:'+brandId+'|party:'+party.id;}

  function mount(opts){
    ensureCss();
    var sb=opts.sb, el=opts.el;
    var S={parties:[],flows:{},threads:[],cur:null,msgs:[],filter:'all',side:'files',fileQ:'',uid:null,sub:null,brands:[]};

    el.classList.add('suwf');
    el.innerHTML =
      '<div class="wstop"><h2>워크플로우</h2><span class="cap">· 거래처 업무 협업</span>'+
      '<div style="flex:1"></div>'+
      '<input class="q" id="suwfQ" placeholder="🔎 요청·자료 전체 검색">'+
      '<button class="newbig" id="suwfNew">+ 새 스레드</button></div>'+
      '<div class="ws" id="suwfGrid"'+(opts.height?' style="height:'+opts.height+'"':'')+'>'+
        '<div class="pane list">'+
          '<div class="lhead"><b>스레드 · <span id="suwfCount">0</span></b><button class="newthread" id="suwfNew2">+ 새로</button></div>'+
          '<div class="filters" id="suwfFilters">'+
            '<span class="f on" data-f="all">전체</span><span class="f" data-f="open">미회신</span>'+
            '<span class="f" data-f="ext">외부 거래처</span><span class="f" data-f="mine">내 담당</span>'+
            '<span class="f" data-f="other">타팀 스레드</span></div>'+
          '<div id="suwfList" style="flex:1;overflow-y:auto"><div class="state" style="padding:22px">불러오는 중…</div></div>'+
          '<div class="note">스레드 = 브랜드 × 거래처. 내부팀도 홈쇼핑사·대행사처럼 하나의 거래처입니다. 완료돼도 계속 이어집니다.</div>'+
        '</div>'+
        '<div class="pane center" id="suwfDetail"><div class="state" style="padding:60px 20px">왼쪽에서 스레드를 선택하거나 <b>+ 새 스레드</b>로 시작하세요.</div></div>'+
        '<div class="pane right">'+
          '<div class="rtabs" id="suwfRTabs"><div class="rtab on" data-v="files">자료함</div><div class="rtab" data-v="ai">🤖 어시스트</div></div>'+
          '<div class="rbody" id="suwfSide"></div>'+
        '</div>'+
      '</div>'+
      '<div class="suwf-mask" id="suwfMask"><div class="suwf-modal">'+
        '<div style="display:flex;align-items:center;margin-bottom:10px"><b style="font-size:16px">새 스레드</b><div style="flex:1"></div><button class="newthread" id="suwfMClose">닫기</button></div>'+
        '<p style="font-size:11.5px;color:#64748B;margin:0 0 10px">브랜드와 거래처를 고르면 상시 스레드가 열립니다. 이미 있으면 그 스레드로 들어갑니다.</p>'+
        '<label>브랜드</label><select id="suwfMBrand"></select>'+
        '<label>거래처</label><select id="suwfMParty"></select>'+
        '<button class="newbig" id="suwfMSave" style="width:100%;margin-top:6px">스레드 열기</button>'+
      '</div></div>';

    var $=function(id){return el.querySelector('#'+id)||document.getElementById(id);};
    function steps(key){var f=S.flows[key];return (f&&f.stages)||[];}
    function flowKey(t){return t.workflow_key||flowFor(t.party);}

    // ---------- 데이터 ----------
    async function load(){
      try{var u=await sb.auth.getUser();S.uid=u&&u.data&&u.data.user&&u.data.user.id;}catch(e){}
      if(!S.parties.length){
        var r1=await sb.from('co_party').select('*').order('sort_no').order('name');
        var r2=await sb.from('co_workflow').select('*');
        S.parties=r1.data||[];(r2.data||[]).forEach(function(f){S.flows[f.key]=f;});
      }
      await loadThreads();
      if(!S.cur){var first=el.querySelector('.thread');if(first)open(first.getAttribute('data-id'));}
      subscribe();
    }
    async function loadThreads(){
      var ch=await sb.from('co_channel').select('*').eq('obj_module','brand').order('updated_at',{ascending:false});
      var list=(ch.data||[]).filter(function(c){return c.party_id;});
      var ids=list.map(function(c){return c.id;}),last={},open={};
      if(ids.length){
        var ms=await sb.from('co_message').select('channel_id,kind,status,created_at,body,author_id').in('channel_id',ids).order('created_at',{ascending:false});
        (ms.data||[]).forEach(function(m){if(!last[m.channel_id])last[m.channel_id]=m;
          if(m.kind==='request'&&m.status!=='done'&&m.status!=='answered')open[m.channel_id]=(open[m.channel_id]||0)+1;});
      }
      S.threads=list.map(function(c){var p=S.parties.filter(function(x){return x.id===c.party_id;})[0]||{};
        return Object.assign({},c,{party:p,last:last[c.id]||null,open:open[c.id]||0});});
      renderList();
      if(opts.onCount)opts.onCount(S.threads.reduce(function(a,t){return a+t.open;},0));
    }

    // ---------- 목록 ----------
    function renderList(){
      var q=(($('suwfQ')||{}).value||'').toLowerCase();
      var mine=opts.partyKinds||HS_KINDS;
      var rows=S.threads;
      if(S.filter==='all')rows=rows.filter(function(t){return mine.indexOf((t.party||{}).kind)>=0;});
      if(S.filter==='open')rows=rows.filter(function(t){return t.open>0;});
      if(S.filter==='ext')rows=rows.filter(function(t){return t.party&&t.party.is_external;});
      if(S.filter==='mine')rows=rows.filter(function(t){return t.created_by===S.uid||(t.last&&t.last.author_id===S.uid);});
      if(S.filter==='other')rows=rows.filter(function(t){return mine.indexOf((t.party||{}).kind)<0;});
      if(q)rows=rows.filter(function(t){return ((t.name||'')+' '+((t.party||{}).name||'')+' '+((t.last||{}).body||'')).toLowerCase().indexOf(q)>=0;});
      $('suwfCount').textContent=rows.length;
      if(!rows.length){$('suwfList').innerHTML='<div class="state" style="padding:22px">스레드가 없습니다 — <b>+ 새로</b>로 시작</div>';return;}
      $('suwfList').innerHTML=rows.map(function(t){
        var brand=(t.name||'').split(' · ')[0]||t.name||'';
        var ext=t.party&&t.party.is_external;
        var stepNm=(steps(flowKey(t)).filter(function(s){return s.key===t.current_step;})[0]||{}).name||'';
        var when=t.last?rel(t.last.created_at):'';
        var on=S.cur&&S.cur.id===t.id?' on':'';
        return '<div class="thread'+on+'" data-id="'+t.id+'">'+
          '<div style="display:flex;align-items:center;gap:8px"><b style="font-size:13px;color:var(--navy)">'+esc(brand)+'</b>'+
            '<div style="flex:1"></div><span style="font-size:10px;color:var(--ink4)">'+when+'</span></div>'+
          '<div style="display:flex;align-items:center;gap:6px;margin-top:5px">'+
            '<span class="dot'+(ext?' ext':'')+'"></span>'+
            '<span style="font-size:11.5px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc((t.party||{}).name||'')+'</span>'+
            '<span class="tag'+(ext?' ext':'')+'">'+(ext?'외부':'자사')+'</span></div>'+
          '<div style="display:flex;align-items:center;margin-top:7px">'+
            (stepNm?'<span class="step-chip">'+esc(stepNm)+'</span>':'<span></span>')+
            '<div style="flex:1"></div>'+
            (t.open?'<span class="unread">'+t.open+'</span>':'<span style="font-size:10px;color:var(--ink4)">읽음</span>')+
          '</div></div>';}).join('');
      Array.prototype.forEach.call($('suwfList').querySelectorAll('.thread'),function(x){x.onclick=function(){open(x.getAttribute('data-id'));};});
    }

    // ---------- 상세 ----------
    async function open(id){
      S.cur=S.threads.filter(function(t){return t.id===id;})[0]||null;if(!S.cur)return;
      renderList();
      var ms=await sb.from('co_message').select('*').eq('channel_id',id).order('created_at');
      S.msgs=ms.data||[];renderDetail();renderSide();
      try{await sb.from('co_channel_member').upsert({channel_id:id,user_id:S.uid,last_read_at:new Date().toISOString()},{onConflict:'channel_id,user_id'});}catch(e){}
    }
    function renderDetail(){
      var t=S.cur;if(!t){$('suwfDetail').innerHTML='<div class="state" style="padding:60px 20px">스레드를 선택하세요</div>';return;}
      var st=steps(flowKey(t)),ci=Math.max(0,st.map(function(s){return s.key;}).indexOf(t.current_step));
      var ext=t.party&&t.party.is_external;
      var h='<div class="chead"><div class="t"><b>'+esc((t.name||'').split(' · ')[0])+'</b><span style="color:var(--ink4)">↔</span><b>'+esc((t.party||{}).name||'')+'</b>'+
        '<span class="tag'+(ext?' ext':'')+'">'+(ext?'외부 거래처':'자사 '+(KIND_LABEL[(t.party||{}).kind]||''))+'</span></div>'+
        '<div class="sub">현재 단계: '+esc((st[ci]||{}).name||'-')+' · 원장 '+S.msgs.length+'건'+(t.open?' · 미회신 '+t.open:'')+'</div></div>';
      h+='<div class="pipe">'+st.map(function(s,i){
        var cls=i<ci?' done':(i===ci?' cur':'');
        return '<div class="step'+cls+'" data-k="'+s.key+'"><div class="b">'+(i<ci?'✓':(i+1))+'</div><small>'+esc(s.name)+'</small></div>';}).join('')+'</div>';
      h+='<div class="ledger" id="suwfLedger">';
      if(!S.msgs.length)h+='<div class="state" style="padding:34px">아직 주고받은 내용이 없습니다. 아래에서 요청·자료를 올려보세요.</div>';
      else h+=S.msgs.map(function(m){
        var kb=KIND_BADGE[m.kind]||KIND_BADGE.note,me=m.author_id===S.uid;
        var sn=(st.filter(function(s){return s.key===m.workflow_step;})[0]||{}).name||'';
        var who=me?(opts.myLabel||'우리'):((t.party||{}).name||'상대');
        var att=(m.attachments||[]).map(function(a){return '<span class="att">📄 '+esc(a.name||'파일')+'</span>';}).join('');
        var dot=m.kind==='request'
          ? '<div style="margin-top:8px;font-size:11px;font-weight:700;color:'+(m.status==='done'?'var(--emerald)':'var(--amber)')+'">● '+(m.status==='done'?'완료':'대기')+'</div>'
          : (m.status==='done'?'<div style="margin-top:8px;font-size:11px;font-weight:700;color:var(--emerald)">● 완료</div>':'');
        return '<div class="item'+(me?' mine':'')+'">'+
          '<div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">'+
          '<span class="kind" style="background:'+kb[1]+'">'+kb[0]+'</span>'+
          '<b style="font-size:12px;color:var(--navy)">'+esc(who)+'</b>'+
          (sn?'<span style="font-size:10.5px;color:var(--sub)">· '+esc(sn)+'</span>':'')+
          '<div style="flex:1"></div><span style="font-size:10px;color:var(--ink4)">'+rel(m.created_at)+'</span></div>'+
          '<p>'+esc(m.body||'')+'</p>'+(att?'<div style="margin-top:9px">'+att+'</div>':'')+dot+
          (m.kind==='request'&&m.status!=='done'?'<div style="margin-top:8px"><button class="newthread suwfDone" data-id="'+m.id+'">완료 표시</button></div>':'')+
        '</div>';}).join('');
      h+='</div>';
      h+='<div class="composer"><div class="ctabs" id="suwfKind">'+
        '<span class="f on" data-v="request">요청</span><span class="f" data-v="reply">회신</span><span class="f" data-v="doc">자료 올리기</span>'+
        '<div style="flex:1"></div><select id="suwfStep" style="font-size:11.5px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;font-family:inherit">'+
        st.map(function(s){return '<option value="'+s.key+'"'+(s.key===t.current_step?' selected':'')+'>'+esc(s.name)+'</option>';}).join('')+'</select></div>'+
        '<div class="cbox"><textarea id="suwfBody" placeholder="예) 통관 후 제조번호별 품질검사 결과 회신 요청드립니다."></textarea>'+
        '<button class="send" id="suwfSend">보내기</button></div>'+
        '<span id="suwfMsg" style="font-size:11px;color:var(--sub)"></span></div>';
      $('suwfDetail').innerHTML=h;
      Array.prototype.forEach.call($('suwfDetail').querySelectorAll('.step'),function(x){x.onclick=function(){setStep(x.getAttribute('data-k'));};});
      Array.prototype.forEach.call($('suwfDetail').querySelectorAll('.suwfDone'),function(x){x.onclick=function(){markDone(x.getAttribute('data-id'));};});
      var kind=$('suwfKind');kind.dataset.v='request';
      kind.onclick=function(e){var b=e.target.closest('.f');if(!b)return;
        Array.prototype.forEach.call(kind.querySelectorAll('.f'),function(x){x.classList.toggle('on',x===b);});kind.dataset.v=b.dataset.v;};
      $('suwfSend').onclick=send;
      $('suwfBody').addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))send();});
      var led=$('suwfLedger');if(led)led.scrollTop=led.scrollHeight;
    }
    function renderSide(){
      var box=$('suwfSide');if(!box)return;
      if(S.side==='ai'){
        var card=function(i,t2,s){return '<div class="aicard"><div style="font-size:12px;font-weight:800">'+i+' '+t2+'</div><div style="font-size:10.5px;color:var(--sub);margin-top:3px">'+s+'</div></div>';};
        box.innerHTML=card('🤖','브랜드 진행 요약','스레드 내용을 요약해 알려줍니다 (준비 중)')+
          card('▸','다음 할 일 제안','단계·미회신 기준 추천 (준비 중)')+
          card('▸','미회신 요청 정리','대기 중인 요청 모음 (준비 중)')+
          card('✍','회신 초안 작성','최근 요청에 대한 회신 문구 자동 초안 (준비 중)');
        return;}
      var files=[];S.msgs.forEach(function(m){(m.attachments||[]).forEach(function(a){files.push({name:a.name,step:m.workflow_step,at:m.created_at,mine:m.author_id===S.uid});});});
      var q=(S.fileQ||'').toLowerCase();
      var show=files.filter(function(f){return !q||String(f.name||'').toLowerCase().indexOf(q)>=0;});
      var t=S.cur||{};
      var h='<input class="q" id="suwfFileQ" placeholder="🔎 이 스레드 문서 검색" value="'+esc(S.fileQ||'')+'">';
      if(!files.length)h+='<div style="font-size:11.5px;color:var(--ink4)">아직 올라온 자료가 없습니다.</div>';
      else if(!show.length)h+='<div style="font-size:11.5px;color:var(--ink4)">검색 결과 없음</div>';
      else h+=show.map(function(f){
        var sn=(steps(flowKey(t)).filter(function(s){return s.key===f.step;})[0]||{}).name||'';
        return '<div class="filerow"><div class="fileico">📄</div><div style="min-width:0">'+
          '<div style="font-size:11.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(f.name||'파일')+'</div>'+
          '<div style="font-size:10px;color:var(--ink4);margin-top:2px">'+(f.mine?'우리':'상대')+(sn?' · '+esc(sn):'')+' · '+rel(f.at)+'</div></div></div>';}).join('');
      box.innerHTML=h;
      var qi=$('suwfFileQ');if(qi)qi.oninput=function(){S.fileQ=qi.value;var p=qi.selectionStart;renderSide();var n=$('suwfFileQ');if(n){n.focus();try{n.setSelectionRange(p,p);}catch(e){}}};
    }

    // ---------- 액션 ----------
    async function setStep(k){
      if(!S.cur)return;var wk=flowKey(S.cur);
      var r=await sb.from('co_channel').update({current_step:k,workflow_key:wk,updated_at:new Date().toISOString()}).eq('id',S.cur.id);
      if(r.error)return;
      S.cur.current_step=k;S.cur.workflow_key=wk;
      S.threads.forEach(function(t){if(t.id===S.cur.id){t.current_step=k;t.workflow_key=wk;}});
      renderDetail();renderList();
    }
    async function markDone(id){
      var r=await sb.from('co_message').update({status:'done'}).eq('id',id);
      if(r.error)return;
      S.msgs.forEach(function(m){if(m.id===id)m.status='done';});
      renderDetail();loadThreads();
    }
    async function send(){
      var t=S.cur;if(!t)return;
      var body=($('suwfBody').value||'').trim();if(!body){$('suwfBody').focus();return;}
      var kind=$('suwfKind').dataset.v||'request';
      var row={tenant_id:t.tenant_id||opts.tenantId,channel_id:t.id,author_id:S.uid,body:body,kind:kind,
        workflow_step:$('suwfStep').value||null,status:kind==='request'?'open':null,attachments:[]};
      var btn=$('suwfSend');btn.disabled=true;
      var r=await sb.from('co_message').insert(row);
      btn.disabled=false;
      if(r.error){$('suwfMsg').innerHTML='<span style="color:#E11D48">전송 실패: '+esc(r.error.message)+'</span>';return;}
      $('suwfBody').value='';$('suwfMsg').textContent='';
      await sb.from('co_channel').update({updated_at:new Date().toISOString()}).eq('id',t.id);
      await open(t.id);loadThreads();
    }
    function subscribe(){
      if(S.sub)return;
      try{S.sub=sb.channel('suwf_rt')
        .on('postgres_changes',{event:'*',schema:'public',table:'co_message'},function(p){
          var cid=(p.new&&p.new.channel_id)||(p.old&&p.old.channel_id);
          if(S.cur&&cid===S.cur.id)open(S.cur.id);else loadThreads();})
        .on('postgres_changes',{event:'*',schema:'public',table:'co_channel'},function(){loadThreads();})
        .subscribe();
      }catch(e){}
    }

    // ---------- 새 스레드 ----------
    async function openNew(){
      if(!S.brands.length&&opts.brandLoader)S.brands=await opts.brandLoader();
      $('suwfMBrand').innerHTML=S.brands.map(function(b){return '<option value="'+b.id+'">'+esc(b.name)+'</option>';}).join('');
      var grp=function(k,l){var arr=S.parties.filter(function(p){return p.kind===k;});
        return arr.length?'<optgroup label="'+l+'">'+arr.map(function(p){return '<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join('')+'</optgroup>':'';};
      $('suwfMParty').innerHTML=grp('internal_team','내부팀')+grp('homeshopping','홈쇼핑사')+grp('agency','대행사')+grp('brand_supplier','공급사')+grp('customs','관세사')+grp('forwarder','포워더')+grp('distributor','판매처');
      $('suwfMask').classList.add('on');
    }
    async function createThread(){
      var bid=$('suwfMBrand').value,pid=$('suwfMParty').value;if(!bid||!pid)return;
      var party=S.parties.filter(function(p){return p.id===pid;})[0]||{id:pid};
      var brand=(S.brands.filter(function(b){return b.id===bid;})[0]||{}).name||'';
      var key=pairKey(bid,party,opts.myTeam),wk=flowFor(party),st=steps(wk);
      var found=await sb.from('co_channel').select('*').eq('pair_key',key).maybeSingle();
      var ch=found.data;
      if(!ch){
        var ex=await sb.from('co_channel').select('*').eq('obj_module','brand').eq('obj_id',bid).eq('party_id',pid).maybeSingle();
        ch=ex.data;
        if(ch&&!ch.pair_key)await sb.from('co_channel').update({pair_key:key}).eq('id',ch.id);
      }
      if(!ch){
        var ins=await sb.from('co_channel').insert({tenant_id:opts.tenantId,kind:'object',name:brand+' · '+party.name,
          obj_module:'brand',obj_type:'brand',obj_id:bid,party_id:pid,pair_key:key,workflow_key:wk,
          current_step:(st[0]||{}).key||null,created_by:S.uid}).select().single();
        if(ins.error){alert('스레드 생성 실패: '+ins.error.message);return;}
        ch=ins.data;
        try{await sb.from('co_channel_member').upsert({channel_id:ch.id,user_id:S.uid,role:'owner'},{onConflict:'channel_id,user_id'});}catch(e){}
      }
      $('suwfMask').classList.remove('on');
      await loadThreads();open(ch.id);
    }

    // ---------- 바인딩 ----------
    $('suwfFilters').onclick=function(e){var b=e.target.closest('.f');if(!b)return;
      Array.prototype.forEach.call($('suwfFilters').children,function(x){x.classList.toggle('on',x===b);});
      S.filter=b.dataset.f;renderList();};
    $('suwfRTabs').onclick=function(e){var b=e.target.closest('.rtab');if(!b)return;
      Array.prototype.forEach.call($('suwfRTabs').children,function(x){x.classList.toggle('on',x===b);});
      S.side=b.dataset.v;renderSide();};
    $('suwfQ').addEventListener('input',renderList);
    $('suwfNew').onclick=openNew;$('suwfNew2').onclick=openNew;
    $('suwfMClose').onclick=function(){$('suwfMask').classList.remove('on');};
    $('suwfMSave').onclick=createThread;

    load();
    return {reload:load, state:S};
  }

  global.SuniverseWF={mount:mount, version:'1.0.0', cssUrl:CSS_URL};
})(window);
