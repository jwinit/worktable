globalThis.MaterialTests = (() => {
  const normalize = text => LinguaCore.normalize(text);
  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function tokens(text, locale) {
    if (typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(locale, {granularity:'word'}).segment(text)]
        .filter(part => part.isWordLike && part.segment.length > 1)
        .map(part => ({text:part.segment,index:part.index}));
    }
    return [...text.matchAll(/[\p{L}\p{N}]{2,}/gu)].map(match => ({text:match[0],index:match.index}));
  }
  function generateMaterial(material, locale = 'en-US') {
    const sentences = [...new Set((material.text || '').match(/[^。！？.!?\n]+[。！？.!?]?/gu) || [])]
      .map(text => text.trim()).filter(text => text.length >= 6 && text.length <= 350);
    const selected = shuffle(sentences).slice(0,5);
    const pool = [...new Set(selected.flatMap(sentence => tokens(sentence,locale).map(token => token.text)))];
    const questions = [];
    for (const sentence of selected) {
      const token = shuffle(tokens(sentence,locale))[0];
      if (token) {
        const distractors = shuffle(pool.filter(word => normalize(word) !== normalize(token.text))).slice(0,3);
        questions.push({id:crypto.randomUUID(),type:distractors.length >= 2 ? 'choice' : 'cloze',
          prompt:'按材料原句补全空缺',context:sentence.slice(0,token.index) + '____' + sentence.slice(token.index + token.text.length),
          answer:token.text,options:distractors.length >= 2 ? shuffle([token.text,...distractors]) : [],
          evidence:sentence,sourceTitle:material.title});
      }
      questions.push({id:crypto.randomUUID(),type:'dictation',prompt:'听句子并写下内容',
        audio:sentence,answer:sentence,evidence:sentence,sourceTitle:material.title});
    }
    return {id:material.id,title:material.title,kind:'material',locale,questions,createdAt:Date.now()};
  }
  function generateWords(words, title, locale = 'en-US') {
    const valid = words.filter(word => word.word?.trim() && word.meaning?.trim());
    const questions = shuffle(valid).slice(0,10).map(word => {
      const alternatives = [...new Set(valid.map(item => item.meaning).filter(meaning => normalize(meaning) !== normalize(word.meaning)))];
      const distractors = shuffle(alternatives).slice(0,3);
      const choice = distractors.length >= 2;
      return {id:crypto.randomUUID(),type:choice ? 'choice' : 'cloze',
        prompt:choice ? '选择词书中的对应释义' : '根据释义写出词书中的单词',
        context:choice ? word.word : word.meaning,answer:choice ? word.meaning : word.word,
        options:choice ? shuffle([word.meaning,...distractors]) : [],
        evidence:[word.word,word.pron,word.meaning,word.example,word.usage].filter(Boolean).join(' · '),sourceTitle:title};
    });
    return {id:crypto.randomUUID(),title,kind:'words',locale,questions,createdAt:Date.now()};
  }
  function grade(question, answer) {
    return normalize(answer || '') !== '' && normalize(answer) === normalize(question.answer);
  }
  function addImported(state, mode, rows) {
    const locale = LinguaCore.locales[LinguaCore.languages.indexOf(state.language)] || 'en-US';
    const generated = mode === 'materials' ? rows.map(row => generateMaterial(row,locale))
      : [generateWords(rows,'导入词书 · ' + new Date().toLocaleString('zh-CN'),locale)];
    state.materialTests ||= [];
    state.materialTests.push(...generated.filter(test => test.questions.length));
    return generated.reduce((total,test) => total + test.questions.length,0);
  }
  return {generateMaterial,generateWords,grade,addImported};
})();

globalThis.installMaterialTests = function ({getState,save,showToast}) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.style.marginBottom = '20px';
  panel.innerHTML = `<h2 style="font-size:20px;margin-top:0">根据学习资料自动出题</h2>
    <p class="notice">文章生成原文填空与听写题，词书生成释义选择或拼写题。答案与原文一起保存，提交后可查看出处。</p>
    <div class="field"><label for="testSource">选择当前语言的资料</label><select id="testSource"></select></div>
    <div class="skill-tabs"><button class="button primary" id="generateTest">生成并开始测验</button></div>
    <div class="field"><label for="savedTest">已生成题组</label><select id="savedTest"></select></div>
    <div class="skill-tabs"><button class="button" id="startSavedTest">开始答题</button><button class="button" id="retryMaterialMistakes">重做错题</button></div>
    <p id="materialTestSummary" role="status"></p>`;
  document.getElementById('quizShell').before(panel);
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-head"><h2 id="materialTestTitle"></h2><button class="close-btn" id="closeMaterialTest" aria-label="关闭测验">×</button></div>
    <div id="materialQuestion"></div><div class="dialog-actions"><button class="button" id="skipMaterialAnswer">跳过并加入错题</button><button class="button primary" id="submitMaterialAnswer">提交答案</button><button class="button" id="nextMaterialQuestion" hidden>下一题</button></div></div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(id);
  let session = null;
  function refresh() {
    session = null;
    dialog.close();
    window.speechSynthesis?.cancel();
    const state = getState();
    state.materialTests ||= [];
    $('testSource').replaceChildren(new Option('当前语言全部词库','words'),...(state.materials || []).map(item => new Option(item.title,'material:' + item.id)));
    $('savedTest').replaceChildren(...state.materialTests.map(test => new Option(test.title + '（' + test.questions.length + ' 题）',test.id)));
    if (state.materialTests.length) $('savedTest').value = state.materialTests.at(-1).id;
    summary();
  }
  function selectedTest() { return getState().materialTests.find(test => test.id === $('savedTest').value); }
  function summary() {
    const test = selectedTest();
    $('startSavedTest').disabled = !test;
    $('retryMaterialMistakes').disabled = !test?.wrongIds?.length;
    $('materialTestSummary').textContent = !test ? '导入资料时会自动生成题组，也可以选择已有资料生成。'
      : test.lastResult ? '最近一次答对 ' + test.lastResult.correct + ' / ' + test.lastResult.total + ' 题，待巩固 ' + (test.wrongIds?.length || 0) + ' 题。' : '题组已准备好，共 ' + test.questions.length + ' 题。';
  }
  function start(test, wrongOnly = false) {
    if (!test) return;
    const questions = wrongOnly ? test.questions.filter(question => test.wrongIds.includes(question.id)) : test.questions;
    if (!questions.length) return showToast('当前题组没有可测验的题目');
    session = {test,questions,index:0,correct:0,answered:false,language:getState().language};
    dialog.showModal(); draw();
  }
  function draw() {
    const question = session.questions[session.index];
    session.answered = false;
    $('materialTestTitle').textContent = '材料测验 · ' + (session.index + 1) + ' / ' + session.questions.length;
    $('materialQuestion').innerHTML = `<p id="questionPrompt"></p><p id="questionContext" class="reading-text"></p>
      <button class="button" id="questionAudio" hidden>播放句子</button><div id="questionOptions" class="field"></div>
      <div class="field" id="writtenAnswerField"><label for="writtenAnswer">你的答案</label><textarea id="writtenAnswer" rows="3"></textarea></div>
      <p id="questionFeedback" role="status"></p><details id="questionEvidence" hidden><summary>答案与材料出处</summary><p id="expectedAnswer"></p><p id="evidenceText" class="reading-text"></p></details>`;
    $('questionPrompt').textContent = question.prompt;
    $('questionContext').textContent = question.context || '';
    $('writtenAnswerField').hidden = question.type === 'choice';
    if (question.type === 'choice') question.options.forEach((option,index) => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'radio'; input.name = 'materialAnswer'; input.value = option;
      label.append(input,document.createTextNode(' ' + option));
      $('questionOptions').append(label);
    });
    if (question.type === 'dictation') {
      $('questionAudio').hidden = false;
      $('questionAudio').onclick = () => {
        if (!('speechSynthesis' in window)) return showToast('设备不支持语音，请跳过听写题');
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(question.audio);
        utterance.lang = session.test.locale; utterance.rate = 0.85;
        utterance.onerror = () => showToast('朗读失败，请检查设备的对应语言语音');
        speechSynthesis.speak(utterance);
      };
    }
    $('submitMaterialAnswer').hidden = false;
    $('skipMaterialAnswer').hidden = false;
    $('nextMaterialQuestion').hidden = true;
    $('nextMaterialQuestion').textContent = session.index === session.questions.length - 1 ? '查看结果' : '下一题';
  }
  function submitAnswer(skipped = false) {
    if (!session || session.answered || session.language !== getState().language) return;
    const question = session.questions[session.index];
    const answer = question.type === 'choice' ? dialog.querySelector('input[name="materialAnswer"]:checked')?.value : $('writtenAnswer').value;
    if (!skipped && !answer?.trim()) return showToast('请填写或选择答案后提交');
    const correct = !skipped && MaterialTests.grade(question,answer);
    const before = [...(session.test.wrongIds || [])];
    const wrong = new Set(before);
    correct ? wrong.delete(question.id) : wrong.add(question.id);
    session.test.wrongIds = [...wrong];
    try { save(); } catch { session.test.wrongIds = before; return showToast('存储空间不足，请清理后再次提交'); }
    session.answered = true;
    if (correct) session.correct++;
    $('questionFeedback').textContent = correct ? '回答正确。' : '本题已加入错题，请对照材料复习。';
    $('expectedAnswer').textContent = '参考答案：' + question.answer;
    $('evidenceText').textContent = question.sourceTitle + '\n' + question.evidence;
    $('questionEvidence').hidden = false; $('questionEvidence').open = true;
    $('submitMaterialAnswer').hidden = true; $('nextMaterialQuestion').hidden = false;
    $('skipMaterialAnswer').hidden = true;
    summary();
  }
  $('submitMaterialAnswer').onclick = () => submitAnswer();
  $('skipMaterialAnswer').onclick = () => submitAnswer(true);
  $('nextMaterialQuestion').onclick = () => {
    if (!session?.answered) return;
    if (session.index < session.questions.length - 1) { session.index++; draw(); return; }
    const before = session.test.lastResult;
    session.test.lastResult = {correct:session.correct,total:session.questions.length,completedAt:Date.now()};
    try { save(); } catch { session.test.lastResult = before; return showToast('成绩保存失败，请清理设备空间后重试'); }
    $('materialTestTitle').textContent = '本轮完成';
    $('materialQuestion').textContent = '答对 ' + session.correct + ' / ' + session.questions.length + ' 题。可关闭窗口后重做错题。';
    $('nextMaterialQuestion').hidden = true;
    summary();
  };
  $('generateTest').onclick = () => {
    const state = getState(), source = $('testSource').value;
    const locale = LinguaCore.locales[LinguaCore.languages.indexOf(state.language)] || 'en-US';
    let test;
    if (source === 'words') test = MaterialTests.generateWords(state.words,'词库测验 · ' + new Date().toLocaleString('zh-CN'),locale);
    else {
      const material = state.materials.find(item => 'material:' + item.id === source);
      if (!material) return showToast('请先选择学习材料');
      test = MaterialTests.generateMaterial(material,locale);
      test.id = crypto.randomUUID();
    }
    if (!test.questions.length) return showToast('材料过短，或词书缺少单词与释义，请补充内容后生成');
    state.materialTests.push(test);
    try { save(); } catch { state.materialTests.pop(); return showToast('题组保存失败，请减少材料数量'); }
    refresh(); start(test);
  };
  $('startSavedTest').onclick = () => start(selectedTest());
  $('retryMaterialMistakes').onclick = () => start(selectedTest(),true);
  $('savedTest').onchange = summary;
  $('closeMaterialTest').onclick = () => dialog.close();
  dialog.addEventListener('close',() => { session = null; window.speechSynthesis?.cancel(); });
  refresh();
  return {refresh};
};
