/* Data boundaries shared by the application and import checks. */
globalThis.LinguaCore = (() => {
  const languages = ['英语 · English', '日语 · 日本語', '韩语 · 한국어', '法语 · Français', '西班牙语 · Español', '其他语言'];
  const locales = ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES', 'en-US'];
  const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  function parseTable(text, delimiter) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || !cell.length) quoted = !quoted;
        else cell += char;
      } else if (!quoted && char === delimiter) { row.push(cell); cell = ''; }
      else if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += char;
    }
    if (quoted) throw new Error('表格引号未闭合，请检查文件');
    row.push(cell); rows.push(row);
    return rows.filter(values => values.some(value => value.trim()));
  }
  const fields = {
    word: ['word','term','单词','词条','表現','単語'],
    pron: ['pron','pronunciation','reading','读音','音标','読み'],
    meaning: ['meaning','definition','释义','含义','意味'],
    example: ['example','sentence','例句','例文'],
    usage: ['usage','用法'], tags: ['tags','标签']
  };
  function wordsFrom(text, filename) {
    let records;
    if (/\.json$/i.test(filename)) {
      const data = JSON.parse(text.replace(/^\uFEFF/, ''));
      records = Array.isArray(data) ? data : data.words;
      if (!Array.isArray(records)) throw new Error('JSON 应为词条数组或含 words 数组的对象');
    } else {
      const rows = parseTable(text, /\.csv$/i.test(filename) ? ',' : '\t');
      if (!rows.length) return [];
      const header = rows[0].map(value => value.trim().toLowerCase());
      const hasHeader = fields.word.some(key => header.includes(key));
      const keys = ['word','pron','meaning','example','usage','tags'];
      records = (hasHeader ? rows.slice(1) : rows).map(row => Object.fromEntries(keys.map((key, index) => {
        const position = hasHeader ? header.findIndex(label => fields[key].includes(label)) : index;
        return [key, row[position] || ''];
      })));
    }
    return records.map((record, index) => {
      if (!record || typeof record !== 'object') throw new Error('第 ' + (index + 1) + ' 条记录格式错误');
      const entry = {};
      for (const [key, aliases] of Object.entries(fields)) {
        const value = aliases.map(alias => record[alias]).find(value => value !== undefined) ?? '';
        entry[key] = Array.isArray(value) ? value.join(',') : String(value).trim();
      }
      if (!entry.word || !entry.meaning) throw new Error('第 ' + (index + 1) + ' 条缺少单词或释义');
      entry.tags = entry.tags.split(/[,，]/).map(value => value.trim()).filter(Boolean);
      return entry;
    });
  }
  function materialFrom(text, filename) {
    if (/\.srt$/i.test(filename)) text = text.replace(/^\s*\d+\s*$/gm, '').replace(/^.*-->.*$/gm, '');
    if (!text.trim()) throw new Error('学习材料为空');
    return { id: crypto.randomUUID(), title: filename, text: text.trim(), reference: '' };
  }
  function starter(language) {
    if (language === languages[1]) return {
      words: [
        ['図書館','としょかん','图书馆','週末は図書館で本を読みます。'],
        ['借りる','かりる','借入','図書館で本を借ります。'],
        ['静か','しずか','安静','ここは静かです。'],
        ['勉強','べんきょう','学习','毎日日本語を勉強します。']
      ],
      materials: [{id:'ja-library',title:'図書館で過ごす週末 · N5–N4',text:'週末は図書館に行きます。図書館は静かで、本がたくさんあります。私は日本語の本を一冊借ります。毎日少しずつ読んで、新しい言葉を覚えます。',reference:'周末去图书馆。图书馆很安静，有很多书。我借一本日语书，每天读一点，记住新词。'}]
    };
    if (language === languages[0]) return {words:[],materials:[{id:'en-library',title:'A small reading habit · A2',text:'Every Saturday, I visit the library. I choose a short book and read a few pages. When I find a useful word, I write it in my notebook. Small habits help me learn every day.',reference:'每周六我去图书馆，选一本短书读几页。遇到有用的单词就记在笔记本上。小习惯帮助我每天学习。'}]};
    return {words:[],materials:[]};
  }
  return {languages,locales,normalize,parseTable,wordsFrom,materialFrom,starter};
})();
