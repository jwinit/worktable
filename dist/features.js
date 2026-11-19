globalThis.installSkills = function ({ getState, save, render, showToast, openAdd, addMinutes }) {
  const core = LinguaCore;
  const area = document.createElement('section');
  area.className = 'panel skill-workspace';
  area.innerHTML = `
    <div class="panel-head"><div><h2>听说读写工作台</h2><p id="skillLanguage"></p></div>
      <div class="skill-tabs"><button class="button" id="openLibrary">导入词书 / 材料</button><button class="button" id="openMaterialTests">材料测验</button></div></div>
    <div class="field"><label for="materialChoice">练习材料</label><select id="materialChoice"></select></div>
    <div class="skill-tabs" role="group" aria-label="练习类型">
      <button class="button" data-skill="listen">听 · 听写</button><button class="button" data-skill="speak">说 · 复述</button>
      <button class="button" data-skill="read">读 · 理解</button><button class="button" data-skill="write">写 · 表达</button>
    </div>
    <div id="skillBody"></div><p class="notice" id="skillStatus"></p>`;
  document.querySelector('#view-home .hero').after(area);
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-head"><h2>批量导入资料</h2><button class="close-btn" id="closeLibrary">×</button></div>
    <div class="field"><label for="importKind">资料类型</label><select id="importKind"><option value="words">词书 · CSV / TSV / TXT / JSON</option><option value="materials">学习材料 · TXT / Markdown / SRT / JSON</option></select></div>
    <p class="notice">词书表头支持 word、pronunciation、meaning、example、usage、tags 或对应中文。无表头时按上述六列排列，以 Tab 分隔。材料 JSON 支持 title、text、reference 字段。</p>
    <p class="notice">文件使用 UTF-8 编码，每个文件最大 2 MB。PDF、Word、扫描件请先导出为文本。资料保存在当前设备。</p>
    <input id="libraryFiles" type="file" multiple accept=".csv,.tsv,.txt,.json,.md,.srt" aria-label="选择多个词书或材料文件">
    <div class="field"><label for="libraryPaste">也可以粘贴表格或文章</label><textarea id="libraryPaste" rows="5"></textarea></div>
    <button class="button" id="previewLibrary">解析并预览</button><pre id="libraryPreview" aria-live="polite"></pre>
    <div class="dialog-actions"><button class="button primary" id="confirmLibrary" disabled>确认导入</button></div></div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(id);
  let skill = 'listen', selected = '', pending = null, recorder = null, stream = null, recordingUrl = null;
  let requestVersion = 0;
  const materialTests = installMaterialTests({getState,save,showToast});
  $('openMaterialTests').onclick = () => document.querySelector('[data-view="quiz"]').click();
  function material() { return getState().materials.find(item => item.id === selected); }
  function entry() {
    const state = getState();
    state.practice ||= {};
    state.practice[selected] ||= {};
    return state.practice[selected];
  }
  function stop() {
    requestVersion++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
  }
  function refresh() {
    stop();
    materialTests.refresh();
    const state = getState();
    state.materials ||= core.starter(state.language).materials;
    $('skillLanguage').textContent = state.language + ' · 每天听、说、读、写各练一次';
    const materials = state.materials;
    if (!materials.some(item => item.id === selected)) selected = materials[0]?.id || '';
    $('materialChoice').replaceChildren(...materials.map(item => new Option(item.title, item.id)));
    $('materialChoice').value = selected;
    draw();
  }
  function draw() {
    const item = material(), body = $('skillBody');
    area.querySelectorAll('[data-skill]').forEach(button => {
      button.classList.toggle('primary', button.dataset.skill === skill);
      button.setAttribute('aria-pressed', button.dataset.skill === skill);
    });
    if (!item) {
      body.innerHTML = '<p>当前语言还没有学习材料，导入文章后即可开始四项练习。</p>';
      $('skillStatus').textContent = '';
      return;
    }
    const prompts = {
      listen: '播放材料，听后写下内容，再展开原文逐句核对。',
      speak: '读懂材料后，用目标语言复述。录音回放，检查表达是否清楚。',
      read: '阅读材料，写出主要意思，并摘录一个支持主旨的原句。',
      write: '围绕材料主题写一段自己的经历，至少使用两个相关表达。'
    };
    body.innerHTML = `<p id="practicePrompt"></p>
      <div class="skill-tabs"><button class="button" id="playMaterial">播放材料</button><button class="button" id="stopSpeech">停止朗读</button>
      <label>语速 <select id="speechRate"><option value="0.75">慢速</option><option value="1" selected>正常</option></select></label></div>
      <details id="sourceDetails"><summary>查看原文与参考理解</summary><p id="sourceText" class="reading-text"></p><p id="sourceReference" class="notice"></p></details>
      <div id="recordingTools" hidden><button class="button" id="startRecording">开始录音</button><button class="button" id="stopRecording" disabled>结束录音</button>
      <audio id="recordingAudio" controls hidden></audio><a id="recordingDownload" hidden>下载本次录音</a><p class="notice">录音用于自听与下载，切换材料前请保存。需要 HTTPS 或 localhost 和麦克风权限。</p></div>
      <div class="field"><label for="practiceAnswer" id="answerLabel"></label><textarea id="practiceAnswer" rows="6"></textarea></div>
      <div class="skill-tabs"><button class="button primary" id="savePractice">保存练习</button><button class="button" id="checkPractice">核对与自评</button><button class="button" id="excerptWord">把阅读选中的词加入词库</button></div>
      <p id="practiceFeedback" aria-live="polite"></p>
      <div class="field"><label for="practiceGap">费曼查漏 · 哪一点还解释不清？</label><textarea id="practiceGap" rows="2"></textarea></div>
      <button class="button" id="completePractice">完成自评并安排复习</button>`;
    $('practicePrompt').textContent = prompts[skill];
    $('sourceText').textContent = item.text;
    $('sourceReference').textContent = item.reference || '导入材料未提供参考理解，请对照原文自行检查。';
    $('sourceDetails').open = skill !== 'listen';
    $('recordingTools').hidden = skill !== 'speak';
    $('excerptWord').hidden = skill !== 'read';
    $('answerLabel').textContent = {listen:'听写内容',speak:'复述提纲 / 自听记录',read:'主旨与证据',write:'我的写作'}[skill];
    const record = entry()[skill] || {};
    $('practiceAnswer').value = record.answer || '';
    $('practiceGap').value = record.gap || '';
    $('playMaterial').onclick = () => {
      if (!('speechSynthesis' in window)) return showToast('此浏览器不支持朗读');
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = core.locales[core.languages.indexOf(getState().language)] || 'en-US';
      utterance.rate = Number($('speechRate').value);
      utterance.onerror = () => showToast('朗读失败，请检查设备是否安装了对应语言语音');
      speechSynthesis.speak(utterance);
    };
    $('stopSpeech').onclick = () => window.speechSynthesis?.cancel();
    $('savePractice').onclick = () => storePractice(false);
    $('completePractice').onclick = () => storePractice(true);
    $('checkPractice').onclick = () => {
      const answer = $('practiceAnswer').value.trim();
      if (!answer) return showToast('请先填写练习内容');
      $('sourceDetails').open = true;
      $('practiceFeedback').textContent = skill === 'listen'
        ? (core.normalize(answer) === core.normalize(item.text) ? '听写与原文一致（忽略空格和标点）。' : '听写与原文有差异，请逐句检查漏听的词和句尾。')
        : '自评清单：是否表达了主旨？是否使用具体例句？能否用更简单的话解释？参考理解供核对，当前练习采用自评。';
    };
    $('excerptWord').onmousedown = event => event.preventDefault();
    $('excerptWord').onclick = () => {
      const selection = window.getSelection();
      const word = selection?.toString().trim();
      if (!word || !selection.anchorNode || !$('sourceText').contains(selection.anchorNode)) return showToast('请先在原文中选中一个词');
      openAdd();
      $('wordInput').value = word;
      $('exampleInput').value = item.text;
    };
    $('startRecording').onclick = startRecording;
    $('stopRecording').onclick = () => recorder?.stop();
    showStatus();
  }
  function storePractice(complete) {
    const answer = $('practiceAnswer').value.trim();
    if (!answer) return showToast('请先填写练习内容');
    const previous = entry()[skill] || {};
    const intervals = [1,2,4,7,15,30];
    const gap = $('practiceGap').value.trim();
    const today = new Date().toLocaleDateString('en-CA');
    const isNewCompletion = complete && previous.completedOn !== today;
    const stage = isNewCompletion ? (gap ? 0 : Math.min((previous.stage ?? -1) + 1, 5)) : (previous.stage || 0);
    entry()[skill] = { ...previous, answer, gap, stage, updatedAt:Date.now() };
    if (isNewCompletion) {
      const next = new Date(); next.setDate(next.getDate() + intervals[stage]);
      entry()[skill].nextReviewAt = next.getTime();
      entry()[skill].completedOn = today;
      addMinutes(3);
    }
    try { save(); render(); showStatus(); showToast(complete ? '已保存自评与下一次复习时间' : '练习已保存'); }
    catch { showToast('设备存储空间不足，请先导出备份并减少导入量'); }
  }
  function showStatus() {
    const practice = entry();
    const names = {listen:'听',speak:'说',read:'读',write:'写'};
    $('skillStatus').textContent = Object.entries(names).map(([key,name]) => {
      const record = practice[key];
      if (!record?.nextReviewAt) return name + '：待练习';
      return name + '：' + (record.nextReviewAt <= Date.now() ? '到期复习' : '下次 ' + new Date(record.nextReviewAt).toLocaleDateString());
    }).join(' · ');
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showToast('此浏览器不支持录音，可填写复述提纲并自评');
    const version = ++requestVersion;
    $('startRecording').disabled = true;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({audio:true});
      if (version !== requestVersion) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream = microphone;
      const chunks = [];
      const currentRecorder = new MediaRecorder(stream);
      recorder = currentRecorder;
      currentRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      currentRecorder.onstop = () => {
        microphone.getTracks().forEach(track => track.stop());
        if (version !== requestVersion) return;
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = URL.createObjectURL(new Blob(chunks,{type:currentRecorder.mimeType}));
        $('recordingAudio').src = recordingUrl; $('recordingAudio').hidden = false;
        $('recordingDownload').href = recordingUrl;
        $('recordingDownload').download = 'lingua-speaking.' + (currentRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm');
        $('recordingDownload').hidden = false;
        $('startRecording').disabled = false; $('stopRecording').disabled = true;
      };
      currentRecorder.start(); $('stopRecording').disabled = false;
      showToast('正在录音，完成后点击结束录音');
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      if (version === requestVersion) $('startRecording').disabled = false;
      showToast('无法使用麦克风，请检查浏览器权限');
    }
  }
  function openLibrary() { pending = null; $('confirmLibrary').disabled = true; $('libraryPreview').textContent = ''; dialog.showModal(); }
  $('openLibrary').onclick = openLibrary;
  document.getElementById('importButton').onclick = openLibrary;
  $('closeLibrary').onclick = () => dialog.close();
  const invalidate = () => { pending = null; $('confirmLibrary').disabled = true; };
  $('libraryFiles').onchange = invalidate; $('libraryPaste').oninput = invalidate; $('importKind').onchange = invalidate;
  $('previewLibrary').onclick = async () => {
    invalidate();
    const mode = $('importKind').value, language = getState().language;
    $('previewLibrary').disabled = true;
    try {
      const inputs = [];
      for (const file of $('libraryFiles').files) {
        if (file.size > 2 * 1024 * 1024) throw new Error(file.name + ' 超过 2 MB');
        inputs.push({name:file.name,text:await file.text()});
      }
      if ($('libraryPaste').value.trim()) inputs.push({name:mode === 'words' ? '粘贴词书.tsv' : '粘贴文章.txt',text:$('libraryPaste').value});
      if (!inputs.length) throw new Error('请选择文件或粘贴内容');
      let rows = [];
      for (const input of inputs) {
        if (mode === 'words') {
          if (!/\.(csv|tsv|txt|json)$/i.test(input.name)) throw new Error('词书支持 CSV、TSV、TXT、JSON');
          rows.push(...core.wordsFrom(input.text,input.name));
        } else if (/\.json$/i.test(input.name)) {
          const data = JSON.parse(input.text.replace(/^\uFEFF/,''));
          const materials = Array.isArray(data) ? data : data.materials;
          if (!Array.isArray(materials)) throw new Error('材料 JSON 应为数组或含 materials 数组的对象');
          for (const item of materials) {
            if (typeof item?.text !== 'string') throw new Error('材料缺少 text 文本字段');
            rows.push({...core.materialFrom(item.text,String(item.title || input.name)),reference:String(item.reference || '')});
          }
        } else {
          if (!/\.(txt|md|srt)$/i.test(input.name)) throw new Error('材料支持 TXT、Markdown、SRT、JSON');
          rows.push(core.materialFrom(input.text,input.name));
        }
      }
      if (language !== getState().language) throw new Error('语言已切换，请重新预览');
      const existing = mode === 'words' ? getState().words : getState().materials;
      const key = item => mode === 'words' ? core.normalize(item.word) : item.text.trim();
      const seen = new Set(existing.map(key));
      const unique = rows.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
      pending = {mode,language,rows:unique};
      $('libraryPreview').textContent = language + '\n可导入 ' + unique.length + ' 条，跳过重复 ' + (rows.length - unique.length) + ' 条\n' + unique.slice(0,8).map(item => item.word ? item.word + ' — ' + item.meaning : item.title + '\n' + item.text.slice(0,120)).join('\n');
      $('confirmLibrary').disabled = !unique.length;
    } catch(error) { $('libraryPreview').textContent = error.message; }
    finally { $('previewLibrary').disabled = false; }
  };
  $('confirmLibrary').onclick = () => {
    if (!pending || pending.language !== getState().language) return showToast('请重新预览当前语言的资料');
    const state = getState(), before = state[pending.mode];
    const rows = pending.mode === 'words' ? pending.rows.map(item => ({...item,id:crypto.randomUUID(),stage:0,learnedAt:null,nextReviewAt:Date.now(),lastReviewedAt:null,reviewCount:0,createdAt:Date.now()})) : pending.rows;
    state[pending.mode] = [...before,...rows];
    const previousTests = [...(state.materialTests || [])];
    let questionCount;
    try {
      questionCount = MaterialTests.addImported(state,pending.mode,rows);
      save();
    } catch {
      state[pending.mode] = before;
      state.materialTests = previousTests;
      return showToast('导入未完成，已撤回本次资料与题组，请检查设备存储空间');
    }
    const count = rows.length; pending = null; dialog.close(); render(); refresh();
    showToast('已导入 ' + count + ' 条资料，并生成 ' + questionCount + ' 道题，请打开材料测验');
  };
  $('materialChoice').onchange = event => { stop(); selected = event.target.value; draw(); };
  area.querySelectorAll('[data-skill]').forEach(button => button.onclick = () => { stop(); skill = button.dataset.skill; draw(); });
  window.addEventListener('pagehide',stop);
  refresh();
  return {refresh,stop};
};
