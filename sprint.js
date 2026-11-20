(() => {
  'use strict';
  const M = SprintModel, KEY = 'lingua_sprint_v1';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const languageName = lang => lang === 'en' ? '英语' : '日语';
  let state, corrupt = false;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? M.validateBackup(JSON.parse(raw)) : M.initial();
  } catch { state = M.initial(); corrupt = true; }
  let selectedDate = M.today(), weekDate = selectedDate, activeSessionId = null, activeGroup = 0, logSlot = null, pendingBackup = null;
  let toastTimer;
  function toast(message) {
    $('toast').textContent = message; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'),4500);
  }
  function commit(change) {
    if (corrupt) { toast('已有数据读取失败，请先导出备份或恢复有效备份，再保存新记录'); return false; }
    const before = JSON.stringify(state);
    try { change(); localStorage.setItem(KEY,JSON.stringify(state)); return true; }
    catch(error) { state = JSON.parse(before); toast('保存未完成：'+error.message); return false; }
  }
  function allowed(date) {
    if(date > M.today()) { toast('未来课程可预览，实际记录请在学习当天提交'); return false; }
    return true;
  }
  function navigate(view) {
    document.querySelectorAll('.view').forEach(element => element.classList.toggle('active',element.id==='view-'+view));
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view===view));
    render(); window.scrollTo({top:0,behavior:'smooth'});
  }
  function sessionFor(slot,date) {
    return Object.values(state.sessions).find(session => session.date===date&&session.lang===slot.lang&&session.period===slot.period&&!session.diagnostic&&!session.review);
  }
  function taskHTML(slot) {
    const lesson = M.unit(state,slot.lang,selectedDate);
    const session = sessionFor(slot,selectedDate);
    const course = session?.id || M.courseId(state,slot,selectedDate);
    const record = state.logs[selectedDate]?.[slot.id];
    const answers = session ? Object.values(session.answers).filter(answer=>answer.graded) : [];
    const status = record?.done ? '已完成 · '+record.minutes+' 分钟' : record?.minutes ? '已记录 '+record.minutes+' 分钟' : '待学习';
    return `<article class="task"><div class="task-top"><span class="lang-label ${slot.lang}">${slot.lang.toUpperCase()} · ${slot.minutes} 分钟</span><span class="task-status ${record?.done?'done':''}">${escape(status)}</span></div>
      <h3>${escape(slot.title+' · '+(session?.title||lesson.title))}</h3><div class="code">${escape(course)}</div>
      <p>${escape(slot.parts)}</p><p>${answers.length?'已提交 '+answers.length+' 题，答对 '+answers.filter(answer=>answer.correct).length+' 题':'尚无本课答案记录'}</p>
      <div class="actions"><button data-lesson="${slot.id}">${selectedDate>M.today()?'预览课程':session?'继续／查看课程':'开始课程'}</button><button class="secondary" data-log="${slot.id}" ${selectedDate>M.today()?'disabled':''}>记录实际完成</button></div></article>`;
  }
  function renderToday() {
    const plan = M.plan(state,selectedDate), stats = M.statistics(state,[selectedDate]);
    const actual = stats.en.minutes + stats.ja.minutes;
    $('studyDate').value=selectedDate;
    $('planDescription').textContent=plan.active?'第 '+plan.day+' 天 · 第 '+plan.week+' 周 · '+M.phases[plan.phase]:'计划从 '+state.start+' 至 '+M.shift(plan.end,-1);
    $('outOfPlan').hidden=plan.active;
    $('outOfPlan').textContent=selectedDate<state.start?'所选日期早于计划起点，可在计划设置调整开始日期。':'这一天已超出半年计划，可继续复习已有知识点。';
    $('actualTotal').innerHTML=actual+'<span> / 120</span>';
    $('dailyProgress').style.width=Math.min(100,actual/120*100)+'%';
    $('enTime').innerHTML=stats.en.minutes+' <small>/ 70 分钟</small>';
    $('jaTime').innerHTML=stats.ja.minutes+' <small>/ 50 分钟</small>';
    $('jaTime').classList.toggle('error',stats.ja.minutes>50);
    const total=stats.en.total+stats.ja.total,correct=stats.en.correct+stats.ja.correct;
    $('answerStat').textContent=total?correct+' / '+total:'暂无答案';
    const due=Object.values(state.knowledge).filter(item=>item.next<=selectedDate);
    $('dueStat').innerHTML=due.length+' <small>个知识点</small>';
    $('dueCount').textContent=due.length||'';
    $('streakBadge').textContent='连续打卡 '+M.streak(state)+' 天';
    const allDone=M.slots.every(slot=>state.logs[selectedDate]?.[slot.id]?.done);
    const checked=state.checkins.includes(selectedDate);
    $('checkIn').disabled=!plan.active||selectedDate>M.today()||!allDone||checked;
    $('checkIn').textContent=checked?'今日已打卡':'完成今日打卡';
    $('checkinStatus').textContent=stats.ja.minutes>50?'日语实际超出 50 分钟，请下次控制时长':actual>120?'今日实际超出 120 分钟，已如实记录':checked?'已保存四个时段的实际完成记录':allDone?'四个时段已完成，可以打卡':'完成四个时段后打卡';
    for(const period of ['am','pm']) $(period==='am'?'morningTasks':'eveningTasks').innerHTML=plan.active?M.slots.filter(slot=>slot.period===period).map(taskHTML).join(''):'<div class="empty">当前日期不在计划范围内</div>';
    $('phaseList').innerHTML=M.phases.map((title,index)=>`<div class="phase ${index===plan.phase?'active':''}"><i></i><span>${escape(title)}</span></div>`).join('');
    $('phaseExplanation').textContent='上方为日历计划阶段。训练阶段依据答案证据推进，每阶段至少 6 个有答题的学习日，最近 30 题达到 80% 后才进入下一阶段。';
    $('adaptiveNotes').innerHTML=['en','ja'].map(lang=>{
      const focus=M.focus(state,lang,selectedDate), phase=M.trainingPhase(state,lang,selectedDate);
      return `<div class="phase-exact"><b>${languageName(lang)} · ${escape(M.phases[phase])}</b><p>${escape(focus.reason)}</p></div>`;
    }).join('');
    $('dailyNote').value=state.notes[selectedDate]||'';
    $('saveNote').disabled=selectedDate>M.today();
    document.querySelectorAll('[data-lesson]').forEach(button=>button.onclick=()=>startLesson(M.slots.find(slot=>slot.id===button.dataset.lesson)));
    document.querySelectorAll('[data-log]').forEach(button=>button.onclick=()=>openLog(M.slots.find(slot=>slot.id===button.dataset.log)));
  }
  function renderReview() {
    const language=$('reviewLanguage').value;
    const items=Object.entries(state.knowledge).filter(([,item])=>(language==='all'||item.lang===language)&&(!$('dueOnly').checked||item.next<=M.today())).sort((a,b)=>a[1].next.localeCompare(b[1].next));
    $('reviewList').innerHTML=items.length?items.map(([key,item])=>`<article class="review-item"><span class="lang-label ${item.lang}">${languageName(item.lang)} · ${item.wrong?'错题待巩固':'知识点复习'}</span><h3>${escape(item.question.prompt)}</h3><p>${escape(item.courseId)} · 下次 ${escape(item.next)} · 当前间隔 ${M.intervals[item.stage]} 天</p><button data-review="${escape(key)}">回忆并复习</button></article>`).join(''):'<div class="empty">当前没有符合条件的知识点。完成课程题目后，会根据实际答案安排复习。</div>';
    document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>startReview(button.dataset.review));
  }
  function renderWeek() {
    const dates=M.weekDates(weekDate),stats=M.statistics(state,dates);
    $('weekRange').textContent=dates[0]+' 至 '+dates[6];
    $('weekStats').innerHTML=['en','ja'].flatMap(lang=>[
      `<article><span>${languageName(lang)}实际学习</span><b>${stats[lang].minutes} <small>分钟</small></b><p>每周计划 ${lang==='en'?490:350} 分钟</p></article>`,
      `<article><span>${languageName(lang)}客观题</span><b>${stats[lang].total?Math.round(stats[lang].correct/stats[lang].total*100)+'%':'暂无答案'}</b><p>${stats[lang].correct} / ${stats[lang].total} 题正确 · 完成 ${stats[lang].completed} 个时段</p></article>`
    ]).join('');
    const daily=dates.map(date=>M.statistics(state,[date]));
    const max=Math.max(70,...daily.flatMap(day=>[day.en.minutes,day.ja.minutes]));
    $('weekChart').innerHTML=dates.map((date,index)=>`<div class="day-column"><b>${daily[index].en.minutes+daily[index].ja.minutes} 分</b><div class="day-bars"><i style="height:${daily[index].en.minutes/max*140}px" title="英语 ${daily[index].en.minutes} 分钟"></i><i class="ja" style="height:${daily[index].ja.minutes/max*140}px" title="日语 ${daily[index].ja.minutes} 分钟"></i></div><span>${date.slice(5)}</span><small>${state.checkins.includes(date)?'已打卡':'未打卡'}</small></div>`).join('');
    $('skillStats').innerHTML=['en','ja'].map(lang=>{
      const sessions=Object.values(state.sessions).filter(session=>session.lang===lang&&dates.includes(session.date));
      const skills=['grammar','read','listen','kana'].map(skill=>{
        const records=sessions.flatMap(session=>session.questions.filter(question=>question.skill===skill).map(question=>session.answers[question.id])).filter(answer=>answer?.graded);
        if(skill==='kana'&&lang==='en')return '';
        return `<p>${{grammar:'句型／语法',read:'阅读',listen:'听力',kana:'假名'}[skill]} · ${records.length?records.filter(answer=>answer.correct).length+' / '+records.length+' 题正确':'尚无答案记录'}</p>`;
      }).join('');
      const outputs=sessions.filter(session=>session.output?.writing||session.output?.speaking).length;
      return `<section class="card"><h2>${languageName(lang)}技能记录</h2>${skills}<p>写作／口语输出 ${outputs} 份，采用自评，未换算考试成绩。</p></section>`;
    }).join('');
  }
  function renderRecords() {
    const days=[...new Set([...Object.keys(state.logs),...Object.keys(state.notes)])].sort().reverse();
    const logHTML=days.map(date=>`<article class="record"><h3>${escape(date)} ${state.checkins.includes(date)?'· 已打卡':''}</h3>${M.slots.map(slot=>{const log=state.logs[date]?.[slot.id];return log?`<p>${slot.title} · ${log.minutes} 分钟 · ${log.done?'完成':'进行中'} · ${escape(log.courseId||'手工记录')}</p><blockquote>${escape(log.note||'')}</blockquote>`:'';}).join('')}<p>${escape(state.notes[date]||'')}</p></article>`).join('');
    const sessions=Object.values(state.sessions).sort((a,b)=>b.createdAt-a.createdAt);
    const sessionHTML=sessions.map(session=>{
      const answers=Object.values(session.answers).filter(answer=>answer.graded);
      return `<article class="record"><h3>${escape(session.id)}</h3><p>${escape(session.date)} · ${languageName(session.lang)} · ${session.diagnostic?'诊断':session.review?'复习':'课程'} · ${answers.length?'答对 '+answers.filter(answer=>answer.correct).length+' / '+answers.length+' 道已提交题':'尚未提交答案'}</p><details><summary>查看答案与解读</summary>${session.questions.map(question=>{
        const answer=session.answers[question.id];
        return answer?.graded?`<div class="answer-feedback ${answer.correct?'':'wrong'}"><b>${escape(question.prompt)}</b><p>实际答案：${escape(answer.value)}</p><p>参考答案：${escape(question.answer)}</p><p>${escape(question.explanation)}</p></div>`:'';
      }).join('')}<p>写作记录：${escape(session.output?.writing||'未提交')}</p><p>口语／自听记录：${escape(session.output?.speaking||'未提交')}</p><p>费曼查漏：${escape(session.output?.gap||'未记录')}</p></details></article>`;
    }).join('');
    const externalHTML=[...state.external].reverse().map(item=>`<article class="record"><h3>${escape(item.courseId)} · 补充记录</h3><p>${escape(item.date)} · ${languageName(item.lang)} · 外部记录未自动计分</p><blockquote>${escape(item.answer)}</blockquote><p>${escape(item.expected?'已记录参考答案：'+item.expected:'参考答案或评分依据待补充')}</p><p>${escape(item.explanation||'')}</p></article>`).join('');
    $('recordList').innerHTML=logHTML+sessionHTML+externalHTML||'<div class="empty">还没有学习记录。开始课程或补充历史记录后，将在这里显示。</div>';
  }
  function renderSettings() {
    $('planStart').value=state.start;
    $('externalDate').max=M.today();
    if(!$('externalDate').value)$('externalDate').value=M.today();
    $('diagnosticStatus').innerHTML=['en','ja'].map(lang=>{
      const session=Object.values(state.sessions).filter(item=>item.lang===lang&&item.diagnostic&&Object.values(item.answers).some(answer=>answer.graded)).sort((a,b)=>b.createdAt-a.createdAt)[0];
      if(!session)return `<div class="diagnostic-result">${languageName(lang)} · 尚无已提交诊断成绩，请完成诊断或补充真实记录。</div>`;
      const records=Object.values(session.answers).filter(answer=>answer.graded);
      return `<div class="diagnostic-result">${languageName(lang)} · ${escape(session.date)} · ${records.filter(answer=>answer.correct).length} / ${records.length} 道已提交题正确${session.complete?'':'（未完成整组）'}<br>该结果不对应 IELTS 分数或 JLPT 等级。</div>`;
    }).join('');
  }
  function render() { renderToday();renderReview();renderWeek();renderRecords();renderSettings(); }
  function importedQuestions(lang,date) {
    try {
      const data=JSON.parse(localStorage.getItem('lingua_workbench_v2')||'null');
      const label=LinguaCore.languages[lang==='en'?0:1], materials=data?.profiles?.[label]?.materials||[];
      if(!materials.length)return [];
      const material=materials[Math.max(0,M.plan(state,date).day-1)%materials.length];
      const test=MaterialTests.generateMaterial(material,lang==='en'?'en-US':'ja-JP');
      return test.questions.slice(0,2).map(question=>{
        let hash=0; for(const char of question.evidence+question.answer)hash=(hash*31+char.codePointAt(0))>>>0;
        return {id:'material-'+material.id+'-'+question.type+'-'+hash,type:question.type==='choice'?'choice':'text',skill:question.type==='dictation'?'listen':'read',prompt:question.prompt+' '+(question.context||''),options:question.options,answer:question.answer,audio:question.audio||'',passage:'',explanation:'材料原文依据：'+question.evidence,source:question.sourceTitle};
      });
    } catch { return []; }
  }
  function startLesson(slot,diagnostic=false) {
    const date=diagnostic?M.today():selectedDate;
    if(!M.plan(state,date).active){toast('请先确认计划开始日期');return;}
    if(date>M.today()) {
      const lesson=M.unit(state,slot.lang,date);
      $('lessonTitle').textContent='课程预览 · '+lesson.title;
      $('lessonCode').textContent=M.courseId(state,slot,date);
      $('lessonContent').innerHTML=`<p>${escape(lesson.lesson)}</p><div class="source">${escape(lesson.example)}</div><p>${escape(lesson.writing)}</p><p>${escape(lesson.speaking)}</p><p class="muted">当天将根据新的诊断与到期记录调整练习。</p>`;
      activeSessionId=null; $('lessonDialog').showModal();return;
    }
    let session=diagnostic?Object.values(state.sessions).find(item=>item.date===date&&item.lang===slot.lang&&item.diagnostic):sessionFor(slot,date);
    if(!session) {
      session=M.makeSession(state,slot,date,diagnostic);
      if(slot.period==='pm'&&!diagnostic)session.questions.push(...importedQuestions(slot.lang,date));
      if(!commit(()=>{state.sessions[session.id]=session;}))return;
    }
    openSession(session.id);
  }
  function startReview(key) {
    const knowledge=state.knowledge[key];
    if(!knowledge)return;
    const date=M.today(),id=knowledge.lang.toUpperCase()+'-REV-'+date+'-'+crypto.randomUUID().slice(0,8);
    const session={id,date,lang:knowledge.lang,phase:M.trainingPhase(state,knowledge.lang,date),period:'am',review:true,diagnostic:false,title:'到期知识点复习',lesson:'先凭记忆作答，再用自己的话解释错在哪里。',example:'',questions:[knowledge.question],answers:{},drafts:{},createdAt:Date.now()};
    if(commit(()=>{state.sessions[id]=session;}))openSession(id);
  }
  function groupsFor(session) {
    if(session.period!=='pm')return session.questions.map(question=>[question]);
    const individual=session.questions.filter(question=>!['read','listen'].includes(question.skill)).map(question=>[question]);
    const batch=session.questions.filter(question=>['read','listen'].includes(question.skill));
    return batch.length?[...individual,batch]:individual;
  }
  function openSession(id) {
    activeSessionId=id;
    const session=state.sessions[id],groups=groupsFor(session);
    activeGroup=groups.findIndex(group=>group.some(question=>!session.answers[question.id]?.graded));
    if(activeGroup<0)activeGroup=groups.length;
    $('lessonDialog').showModal(); drawSession();
  }
  function drawSession() {
    const session=state.sessions[activeSessionId];if(!session)return;
    $('lessonCode').textContent=session.id+' · '+session.date;
    $('lessonTitle').textContent=(session.diagnostic?'起点诊断 · ':session.review?'复习 · ':'')+session.title;
    const groups=groupsFor(session),group=groups[activeGroup];
    if(!group){showSessionResult(session);return;}
    const graded=group.every(question=>session.answers[question.id]?.graded);
    $('lessonContent').innerHTML=`<details ${activeGroup===0&&!session.diagnostic?'open':''}><summary>本课讲解与训练依据</summary><p class="lesson-note">${escape(session.lesson||'')}</p>${session.example?'<div class="source">'+escape(session.example)+'</div>':''}<p class="muted">${escape(session.reason||'根据当前课程记录安排')}</p></details>
      <p class="muted">${group.length>1?'阅读／听力集中提交':'逐题反馈'} · 第 ${activeGroup+1} / ${groups.length} 组</p>
      <form id="questionForm">${group.map((question,index)=>questionHTML(session,question,index,graded)).join('')}<div class="actions">${graded?'<button type="button" id="nextGroup">'+(activeGroup===groups.length-1?'完成本课练习':'进入下一题／组')+'</button>':'<button type="submit">'+(group.length>1?'提交整组并查看评分':'提交并查看解读')+'</button><button type="button" class="secondary" id="skipGroup">不会，查看答案并加入错题</button>'}</div></form>`;
    bindAudio(group);
    if(graded)$('nextGroup').onclick=()=>{window.speechSynthesis?.cancel();activeGroup++;drawSession();};
    else {
      const submit=(skipped=false)=>{
        if(!allowed(session.date))return;
        const values={};
        for(let index=0;index<group.length;index++){
          const question=group[index],name='answer-'+index;
          values[question.id]=skipped?'（跳过）':question.type==='choice'?$('questionForm').querySelector('input[name="'+name+'"]:checked')?.value:$(name)?.value.trim();
          if(!values[question.id]){toast('请完成本组所有题目后提交');return;}
        }
        if(commit(()=>{for(const question of group)M.mark(state,state.sessions[activeSessionId],question,values[question.id]);})){
          window.speechSynthesis?.cancel();drawSession();render();
        }
      };
      $('questionForm').onsubmit=event=>{event.preventDefault();submit();};
      $('skipGroup').onclick=()=>submit(true);
    }
  }
  function questionHTML(session,question,index,graded) {
    const response=session.answers[question.id],name='answer-'+index;
    const input=question.type==='choice'?(question.options||[]).map(option=>`<label class="option"><input type="radio" name="${name}" value="${escape(option)}" ${response?.value===option?'checked':''} ${graded?'disabled':''}>${escape(option)}</label>`).join(''):`<label>你的答案<textarea id="${name}" rows="3" ${graded?'disabled':''}>${escape(response?.value||session.drafts[question.id]||'')}</textarea></label>`;
    const feedback=graded?`<div class="answer-feedback ${response.correct?'':'wrong'}"><b>${response.correct?'回答正确':'需要巩固'}</b><p>你的答案：${escape(response.value)}</p><p>参考答案：${escape(question.answer)}</p><p>${escape(question.explanation)}</p><p>出处：${escape(question.source||session.title)}</p></div>`:'';
    return `<section class="question"><small>${escape({grammar:'句型与语法',read:'阅读',listen:'听力',kana:'假名'}[question.skill]||'练习')}</small>${question.passage?'<div class="source">'+escape(question.passage)+'</div>':''}${question.audio?'<div class="actions"><button type="button" class="secondary" data-audio="'+index+'">播放听力</button><button type="button" class="secondary" data-stop-audio>停止</button></div>':''}<h3>${escape(question.prompt)}</h3>${input}${feedback}${graded&&question.audio?'<details><summary>听力原文</summary><p class="source">'+escape(question.audio)+'</p></details>':''}</section>`;
  }
  function bindAudio(group) {
    document.querySelectorAll('[data-audio]').forEach(button=>button.onclick=()=>{
      if(!('speechSynthesis' in window)){toast('浏览器不支持朗读，可跳过听力题并对照原文复习');return;}
      speechSynthesis.cancel();const question=group[Number(button.dataset.audio)];
      const speech=new SpeechSynthesisUtterance(question.audio);
      speech.lang=state.sessions[activeSessionId].lang==='ja'?'ja-JP':'en-GB';speech.rate=0.85;
      speech.onerror=()=>toast('语音播放失败，请检查设备语言语音或使用原文复习');
      speechSynthesis.speak(speech);
    });
    document.querySelectorAll('[data-stop-audio]').forEach(button=>button.onclick=()=>window.speechSynthesis?.cancel());
  }
  function showSessionResult(session) {
    const answers=Object.values(session.answers).filter(answer=>answer.graded);
    $('lessonContent').innerHTML=`<h3>本课客观题已提交</h3><p>答对 ${answers.filter(answer=>answer.correct).length} / ${answers.length} 题。错题与知识点已安排后续复习。</p><p class="muted">这是本组自编练习的结果，不换算 IELTS 分数或 JLPT 等级。</p>
      <form id="outputForm"><label>写作任务<p class="muted">${escape(session.writing||'用自己的话解释刚才最难的知识点，并补充一个例句。')}</p><textarea id="writingOutput" rows="5">${escape(session.output?.writing||'')}</textarea></label>
      <label>口语任务与自听记录<p class="muted">${escape(session.speaking||'把这道题的解法讲给初学者听。')}</p><textarea id="speakingOutput" rows="3">${escape(session.output?.speaking||'')}</textarea></label>
      <p class="muted">需要录音回放时，可使用资料工作台中的口语练习。口语与写作通过自评记录。</p>
      <label>费曼查漏：哪个地方仍然解释不清？<textarea id="gapOutput" rows="3">${escape(session.output?.gap||'')}</textarea></label>
      <label class="check-label"><input type="checkbox" id="outputReviewed" ${session.output?.reviewed?'checked':''}>已检查主旨、例句、语法与表达是否清楚</label><button type="submit">保存输出与自评</button></form><div class="actions"><button class="secondary" id="finishLesson">返回课程安排</button></div>`;
    $('outputForm').onsubmit=event=>{
      event.preventDefault();
      const output={writing:$('writingOutput').value.trim(),speaking:$('speakingOutput').value.trim(),gap:$('gapOutput').value.trim(),reviewed:$('outputReviewed').checked,at:Date.now()};
      if(!output.writing&&!output.speaking&&!output.gap){toast('请先填写实际输出或查漏记录');return;}
      if(commit(()=>{state.sessions[activeSessionId].output=output;})){toast('已保存输出与自评，请另外记录实际学习时间');render();}
    };
    $('finishLesson').onclick=()=>{$('lessonDialog').close();navigate('today');};
  }
  function openLog(slot) {
    if(!allowed(selectedDate))return;
    logSlot=slot;
    const log=state.logs[selectedDate]?.[slot.id];
    $('logTitle').textContent=selectedDate+' · '+slot.title;
    $('logMinutes').value=log?.minutes??'';$('logDone').checked=!!log?.done;$('logNote').value=log?.note||'';
    $('logDialog').showModal();
  }
  $('logForm').onsubmit=event=>{
    event.preventDefault();if(!logSlot||!allowed(selectedDate))return;
    const minutes=Number($('logMinutes').value),done=$('logDone').checked,note=$('logNote').value.trim();
    if(!Number.isInteger(minutes)||minutes<0||minutes>1440||(done&&minutes===0)){toast('请填写真实学习分钟，完成任务时应大于 0');return;}
    const session=sessionFor(logSlot,selectedDate);
    if(commit(()=>{
      state.logs[selectedDate] ||= {};
      state.logs[selectedDate][logSlot.id]={minutes,done,note,courseId:session?.id||M.courseId(state,logSlot,selectedDate),recordedAt:Date.now()};
      if(!M.slots.every(slot=>state.logs[selectedDate][slot.id]?.done))state.checkins=state.checkins.filter(date=>date!==selectedDate);
    })){$('logDialog').close();render();toast('实际学习记录已保存');}
  };
  $('checkIn').onclick=()=>{
    if(!allowed(selectedDate)||!M.plan(state,selectedDate).active)return;
    if(!M.slots.every(slot=>state.logs[selectedDate]?.[slot.id]?.done)){toast('请先记录四个时段的实际完成情况');return;}
    if(commit(()=>{state.checkins=[...new Set([...state.checkins,selectedDate])];})){render();toast('已完成 '+selectedDate+' 的打卡');}
  };
  $('saveNote').onclick=()=>{if(allowed(selectedDate)&&commit(()=>{state.notes[selectedDate]=$('dailyNote').value.trim();})){toast('备注已保存');renderRecords();}};
  $('planForm').onsubmit=event=>{event.preventDefault();const start=$('planStart').value;if(!M.validDate(start))return;if(commit(()=>{state.start=start;})){render();toast('计划日期已更新，已有学习记录按原日期保留');}};
  $('externalForm').onsubmit=event=>{
    event.preventDefault();
    const item={id:crypto.randomUUID(),date:$('externalDate').value,lang:$('externalLanguage').value,kind:$('externalKind').value,courseId:$('externalCourse').value.trim(),weakness:$('externalWeakness').value,question:$('externalQuestion').value.trim(),answer:$('externalAnswer').value.trim(),expected:$('externalExpected').value.trim(),explanation:$('externalExplanation').value.trim(),createdAt:Date.now()};
    if(!M.validDate(item.date)||!allowed(item.date)||!item.courseId||!item.answer)return;
    if(item.kind==='mistake'&&!item.question){toast('请补充错题题目');return;}
    if(commit(()=>{
      state.external.push(item);
      if(item.kind==='mistake'&&item.question&&item.expected){
        const question={id:'external-'+item.id,type:'text',skill:item.weakness||'grammar',prompt:item.question,answer:item.expected,explanation:item.explanation||'依据用户补充的参考答案核对，解读待补充。',source:item.courseId};
        state.knowledge[item.lang+':'+question.id]={lang:item.lang,question,stage:0,last:item.date,next:M.today(),wrong:true,courseId:item.courseId};
      }
    })){$('externalForm').reset();render();toast('实际记录已保存，未提供评分依据的部分将保持待核对');}
  };
  $('exportBackup').onclick=()=>{
    const data=corrupt?localStorage.getItem(KEY):JSON.stringify(state,null,2);
    const blob=new Blob([data||''],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='lingua-sprint-'+M.today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('restoreBackup').onchange=async event=>{
    pendingBackup=null;$('confirmRestore').hidden=true;
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>10*1024*1024)throw new Error('备份超过 10 MB');
      pendingBackup=M.validateBackup(JSON.parse(await file.text()));
      $('restorePreview').textContent='备份起点 '+pendingBackup.start+'，'+Object.keys(pendingBackup.sessions).length+' 个课程记录，'+pendingBackup.checkins.length+' 个打卡日期。确认后将替换本浏览器的冲刺计划记录。';
      $('confirmRestore').hidden=false;
    }catch(error){$('restorePreview').textContent='无法恢复：'+error.message;}
  };
  $('confirmRestore').onclick=()=>{
    if(!pendingBackup)return;
    try{localStorage.setItem(KEY,JSON.stringify(pendingBackup));state=pendingBackup;pendingBackup=null;corrupt=false;$('confirmRestore').hidden=true;$('restorePreview').textContent='备份已恢复';render();toast('学习备份已恢复');}catch{toast('设备存储空间不足，未替换现有记录');}
  };
  $('closeLesson').onclick=()=>$('lessonDialog').close();
  $('lessonDialog').addEventListener('close',()=>{window.speechSynthesis?.cancel();activeSessionId=null;});
  $('closeLog').onclick=()=>$('logDialog').close();
  $('diagnoseEnglish').onclick=()=>startLesson(M.slots[0],true);
  $('diagnoseJapanese').onclick=()=>startLesson(M.slots[1],true);
  $('studyDate').onchange=event=>{if(M.validDate(event.target.value)){selectedDate=event.target.value;renderToday();}};
  $('prevDate').onclick=()=>{selectedDate=M.shift(selectedDate,-1);renderToday();};
  $('nextDate').onclick=()=>{selectedDate=M.shift(selectedDate,1);renderToday();};
  $('goToday').onclick=()=>{selectedDate=M.today();renderToday();};
  $('prevWeek').onclick=()=>{weekDate=M.shift(weekDate,-7);renderWeek();};
  $('nextWeek').onclick=()=>{weekDate=M.shift(weekDate,7);renderWeek();};
  $('reviewLanguage').onchange=renderReview;$('dueOnly').onchange=renderReview;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>navigate(button.dataset.view));
  document.querySelectorAll('[data-goto]').forEach(button=>button.onclick=()=>navigate(button.dataset.goto));
  window.addEventListener('pagehide',()=>window.speechSynthesis?.cancel());
  render();
  if(corrupt)toast('已有记录读取失败，已保护原始数据。请在计划页面导出原始备份后恢复。');
  if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
