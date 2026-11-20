globalThis.SprintModel = (() => {
  const intervals = [1,2,4,7,15,30];
  const phases = ['起点诊断与基础修补','基础自动化与表达展开','阅读听力与观点表达','综合能力与限定信息','限时训练与自然交流','目标冲刺与证据复盘'];
  const slots = [
    {id:'en-am',lang:'en',period:'am',minutes:50,title:'英语晨课',parts:'阅读 15 分钟 · 听力 10 分钟 · 写作 15 分钟 · 口语 10 分钟'},
    {id:'ja-am',lang:'ja',period:'am',minutes:30,title:'日语晨课',parts:'假名／词汇 10 分钟 · 句型与阅读 10 分钟 · 跟读交流 10 分钟'},
    {id:'en-pm',lang:'en',period:'pm',minutes:20,title:'英语晚测',parts:'阅读与听力测验 12 分钟 · 错题解释与复习 8 分钟'},
    {id:'ja-pm',lang:'ja',period:'pm',minutes:20,title:'日语晚测',parts:'辨音与句型测验 12 分钟 · 复述与查漏 8 分钟'}
  ];
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  function today() {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
  }
  function validDate(value) {
    return typeof value === 'string' && datePattern.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
  }
  const shift = (date, days) => new Date(Date.parse(date+'T00:00:00Z') + days*86400000).toISOString().slice(0,10);
  const daysBetween = (start,end) => Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000);
  function endDate(start) {
    const date = new Date(start+'T00:00:00Z');
    const day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()+6);
    const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    date.setUTCDate(Math.min(day,last));
    return date.toISOString().slice(0,10);
  }
  function initial() {
    return {schema:1,start:'2026-11-19',baseline:{en:'B1（用户自报）',ja:'五十音入门（用户自报）'},logs:{},sessions:{},knowledge:{},external:[],notes:{},checkins:[]};
  }
  function plan(state,date) {
    const day = daysBetween(state.start,date);
    const total = daysBetween(state.start,endDate(state.start));
    return {day:day+1,week:Math.floor(day/7)+1,phase:Math.min(5,Math.max(0,Math.floor(day*6/total))),active:day>=0&&day<total,total,end:endDate(state.start)};
  }
  function answered(state,lang,before) {
    return Object.values(state.sessions).filter(session=>session.lang===lang&&session.date<=before)
      .flatMap(session=>session.questions.map(question=>({question,response:session.answers[question.id],session})))
      .filter(item=>item.response?.graded && item.question.type!=='self');
  }
  function trainingPhase(state,lang,date) {
    const planned = plan(state,date).phase;
    let phase = 0;
    const evidence = answered(state,lang,date);
    while (phase < planned) {
      const current = evidence.filter(item=>item.session.phase===phase);
      const recent = current.slice(-30);
      const distinctDates = new Set(current.map(item=>item.session.date));
      if (recent.length < 30 || distinctDates.size < 6 || recent.filter(item=>item.response.correct).length/recent.length < 0.8) break;
      phase++;
    }
    return phase;
  }
  function focus(state,lang,date) {
    const due = Object.values(state.knowledge).filter(item=>item.lang===lang&&item.next<=date);
    if (due.length) return {skill:due[0].question.skill,reason:'优先复习 '+due.length+' 个到期知识点',due};
    const scores = {};
    answered(state,lang,date).slice(-30).forEach(item=>{
      const key=item.question.skill;
      scores[key] ||= {total:0,wrong:0}; scores[key].total++;
      if(!item.response.correct) scores[key].wrong++;
    });
    const weak = Object.entries(scores).filter(([,score])=>score.wrong>0).sort((a,b)=>b[1].wrong/b[1].total-a[1].wrong/a[1].total)[0];
    if (weak) return {skill:weak[0],reason:'最近答案显示 '+({grammar:'句型',read:'阅读',listen:'听力',kana:'假名'}[weak[0]]||weak[0])+' 需要巩固',due:[]};
    const record = state.external.filter(item=>item.lang===lang&&item.date<=date&&item.weakness).at(-1);
    if (record) return {skill:record.weakness,reason:'依据补充记录 '+record.courseId+' 调整训练重点',due:[]};
    return {skill:null,reason:evidenceCount(state,lang,date)?'依据现有答案保持均衡练习':'尚无已提交诊断或答案，按自报起点安排课程',due:[]};
  }
  const evidenceCount = (state,lang,date) => answered(state,lang,date).length;
  function unit(state,lang,date) {
    const phase=trainingPhase(state,lang,date);
    const pool=SprintData[lang].filter(item=>item.phase===phase);
    const day=Math.max(0,plan(state,date).day-1);
    return pool[day%pool.length];
  }
  function courseId(state,slot,date) {
    return slot.lang.toUpperCase()+'-P'+(trainingPhase(state,slot.lang,date)+1)+'-D'+String(plan(state,date).day).padStart(3,'0')+'-'+slot.period.toUpperCase();
  }
  function questionFrom(unit,skill) {
    const source = skill==='read'?unit.reading:skill==='listen'?unit.listening:unit.grammar;
    return {id:unit.id+'-'+skill,type:'choice',skill,prompt:source[0],options:source[1],answer:source[1][source[2]],explanation:source[3],passage:skill==='read'?unit.passage:'',audio:skill==='listen'?unit.audio:'',source:unit.title};
  }
  function kanaQuestions(date,state) {
    const day=Math.max(0,plan(state,date).day-1);
    return Array.from({length:5},(_,offset)=>{
      const index=(day*5+offset)%SprintData.kana.length;
      const [kana,answer]=SprintData.kana[index];
      const options=[answer,SprintData.kana[(index+7)%46][1],SprintData.kana[(index+13)%46][1]];
      const rotated=options.slice(offset%3).concat(options.slice(0,offset%3));
      return {id:'kana-'+kana,type:'choice',skill:'kana',prompt:'假名「'+kana+'」对应哪一种读音？',options:rotated,answer,explanation:'「'+kana+'」的基本读音为 '+answer+'。边读边写，再与相近的假名对比。',source:'五十音基础'};
    });
  }
  function makeSession(state,slot,date,diagnostic=false) {
    const lesson=unit(state,slot.lang,date);
    let questions=[questionFrom(lesson,'grammar'),questionFrom(lesson,'read'),questionFrom(lesson,'listen')];
    if(slot.lang==='ja'&&lesson.phase===0) questions=[...kanaQuestions(date,state),...questions];
    if(diagnostic&&slot.lang==='en') questions=SprintData.en.filter(item=>item.phase===0).flatMap(item=>[questionFrom(item,'grammar'),questionFrom(item,'read'),questionFrom(item,'listen')]);
    const adaptive=focus(state,slot.lang,date);
    if(!diagnostic) {
      questions=[...adaptive.due.slice(0,3).map(item=>item.question),...questions];
      if(adaptive.skill) questions.sort((a,b)=>Number(b.skill===adaptive.skill)-Number(a.skill===adaptive.skill));
    }
    questions=[...new Map(questions.map(question=>[question.id,question])).values()];
    const id=diagnostic?slot.lang.toUpperCase()+'-DIAG-'+date:courseId(state,slot,date);
    return {id,date,lang:slot.lang,phase:lesson.phase,period:slot.period,diagnostic,title:lesson.title,lesson:lesson.lesson,example:lesson.example,writing:lesson.writing,speaking:lesson.speaking,reason:adaptive.reason,questions,answers:{},drafts:{},createdAt:Date.now()};
  }
  function mark(state,session,question,value) {
    if(session.answers[question.id]?.graded) return session.answers[question.id];
    const correct=LinguaCore.normalize(value)===LinguaCore.normalize(question.answer)&&LinguaCore.normalize(value)!=='';
    const response={value,correct,graded:true,at:Date.now()};
    session.answers[question.id]=response;
    const key=session.lang+':'+question.id;
    const previous=state.knowledge[key];
    // Backfilled historical answers remain visible but cannot overwrite a more recent review.
    if(!previous || previous.last<=session.date) {
      const sameDay=previous?.last===session.date;
      const stage=correct?(sameDay?previous.stage:Math.min((previous?.stage??-1)+1,5)):0;
      state.knowledge[key]={lang:session.lang,question,stage,last:session.date,next:shift(session.date,correct?intervals[stage]:1),wrong:correct?false:true,courseId:session.id};
    }
    session.complete=session.questions.every(item=>session.answers[item.id]?.graded);
    return response;
  }
  function statistics(state,dates) {
    const result={en:{minutes:0,completed:0,correct:0,total:0},ja:{minutes:0,completed:0,correct:0,total:0}};
    for(const date of dates) {
      for(const slot of slots){const log=state.logs[date]?.[slot.id];if(log){result[slot.lang].minutes+=Number(log.minutes)||0;if(log.done)result[slot.lang].completed++;}}
    }
    for(const session of Object.values(state.sessions).filter(item=>dates.includes(item.date))) {
      for(const response of Object.values(session.answers)){if(response.graded){result[session.lang].total++;if(response.correct)result[session.lang].correct++;}}
    }
    return result;
  }
  function weekDates(date) {
    const weekday=new Date(date+'T00:00:00Z').getUTCDay();
    const monday=shift(date,-((weekday+6)%7));
    return Array.from({length:7},(_,index)=>shift(monday,index));
  }
  function streak(state,reference=today()) {
    const dates=new Set(state.checkins.filter(date=>date<=reference));
    let cursor=dates.has(reference)?reference:shift(reference,-1),count=0;
    while(dates.has(cursor)){count++;cursor=shift(cursor,-1);}
    return count;
  }
  function validateBackup(data) {
    if(data?.schema!==1||!validDate(data.start)||!data.logs||!data.sessions||!data.knowledge||!Array.isArray(data.external)||!Array.isArray(data.checkins)||!data.notes) throw new Error('备份结构不正确');
    if([data.logs,data.sessions,data.knowledge,data.notes].some(value=>typeof value!=='object'||Array.isArray(value)))throw new Error('备份字段格式无效');
    const todayValue=today();
    for(const [date,logs] of Object.entries(data.logs)) {
      if(!validDate(date)||date>todayValue) throw new Error('学习日志日期无效');
      for(const [slot,log] of Object.entries(logs))if(!slots.some(item=>item.id===slot)||!Number.isInteger(log.minutes)||log.minutes<0||log.minutes>1440||typeof log.done!=='boolean'||(log.done&&log.minutes===0))throw new Error('学习时间或完成状态无效');
    }
    for(const session of Object.values(data.sessions)) {
      if(!['en','ja'].includes(session.lang)||!validDate(session.date)||session.date>todayValue||!Array.isArray(session.questions)||!session.answers||!session.drafts)throw new Error('课程记录不完整');
      for(const question of session.questions) {
        if(typeof question.id!=='string'||typeof question.prompt!=='string'||typeof question.answer!=='string')throw new Error('题目记录缺少必要字段');
        const response=session.answers[question.id];
        if(response?.graded && response.correct!==(LinguaCore.normalize(response.value||'')===LinguaCore.normalize(question.answer)&&LinguaCore.normalize(response.value||'')!==''))throw new Error('答案与评分记录不一致');
      }
    }
    for(const item of Object.values(data.knowledge)) {
      if(!['en','ja'].includes(item.lang)||!validDate(item.last)||!validDate(item.next)||!Number.isInteger(item.stage)||item.stage<0||item.stage>5||typeof item.question?.id!=='string'||typeof item.question.prompt!=='string'||typeof item.question.answer!=='string')throw new Error('复习记录格式无效');
    }
    for(const item of data.external)if(!['en','ja'].includes(item.lang)||!validDate(item.date)||item.date>todayValue||typeof item.courseId!=='string'||typeof item.answer!=='string')throw new Error('外部记录格式无效');
    for(const [date,note] of Object.entries(data.notes))if(!validDate(date)||typeof note!=='string')throw new Error('备注格式无效');
    if(data.checkins.some(date=>!validDate(date)||date>todayValue))throw new Error('打卡日期无效');
    if(data.checkins.some(date=>!slots.every(slot=>data.logs[date]?.[slot.id]?.done)))throw new Error('打卡缺少对应完成记录');
    return data;
  }
  return {intervals,phases,slots,today,validDate,shift,daysBetween,endDate,initial,plan,trainingPhase,focus,unit,courseId,makeSession,mark,statistics,weekDates,streak,validateBackup};
})();
