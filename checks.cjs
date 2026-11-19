const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const context = {crypto,console,localStorage:{getItem(key){return this[key] || null;},setItem(key,value){this[key]=value;}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/core.js','utf8'),context);
const core = context.LinguaCore;
assert.equal(core.wordsFrom('\uFEFFword,pronunciation,meaning,example\n"図書館",としょかん,图书馆,"line 1, comma\nline 2"','book.csv')[0].example,'line 1, comma\nline 2');
assert.equal(core.wordsFrom('単語\t読み\t意味\n借りる\tかりる\t借入','book.tsv')[0].word,'借りる');
assert.equal(core.wordsFrom('[{"word":"a","meaning":"b","tags":["x"]}]','book.json')[0].tags[0],'x');
assert.throws(()=>core.wordsFrom('word,meaning\na,"broken','x.csv'));
assert.throws(()=>core.wordsFrom('word,meaning\na,','x.csv'));
assert.equal(core.normalize('こんにちは。'),'こんにちは');
assert.ok(!core.materialFrom('1\n00:00:01,000 --> 00:00:02,000\nこんにちは','lesson.srt').text.includes('-->'));
context.localStorage.lingua_daily_workbench_v1=JSON.stringify({language:core.languages[1],words:[{word:'legacy-English',meaning:'旧词'}]});
const app=fs.readFileSync('dist/app.js','utf8');
const boundary=app.indexOf('  const isDue=');
vm.runInContext(app.slice(0,boundary)+'globalThis.result={state,workspace,save};})();',context);
assert.equal(context.result.state.language,core.languages[1]);
assert.equal(context.result.state.words[0].word,'図書館');
assert.equal(context.result.workspace.profiles[core.languages[0]].words[0].word,'legacy-English');
context.result.save();
assert.equal(JSON.parse(context.localStorage.lingua_workbench_v2).active,core.languages[1]);
console.log('PASS: import formats and errors, subtitle cleanup, legacy migration, Japanese profile persistence');
vm.runInContext(fs.readFileSync('dist/material-tests.js','utf8'),context);
const tests = context.MaterialTests;
for (const [locale,text] of [
  ['en-US','I visit the library every Saturday. I borrow a short book and read it at home.'],
  ['ja-JP','毎日図書館に行きます。日本語の本を読みます。']
]) {
  const test = tests.generateMaterial({id:locale,title:'Imported source',text},locale);
  assert.ok(test.questions.length >= 2);
  assert.ok(test.questions.some(question=>question.type==='dictation'));
  for (const question of test.questions) {
    assert.ok(text.includes(question.evidence));
    assert.ok(question.evidence.includes(question.answer));
    assert.ok(tests.grade(question,question.answer));
    assert.equal(tests.grade(question,''),false);
    assert.equal(tests.grade(question,'not-the-answer-123'),false);
    if (question.type==='choice') {
      assert.equal(question.options.filter(option=>option===question.answer).length,1);
      assert.equal(new Set(question.options).size,question.options.length);
    }
  }
}
assert.equal(tests.generateMaterial({id:'empty',text:''}).questions.length,0);
const single = tests.generateWords([{word:'図書館',meaning:'图书馆'}],'One-word book','ja-JP');
assert.equal(single.questions[0].type,'cloze');
assert.ok(tests.grade(single.questions[0],'図書館'));
const state={language:core.languages[1],materialTests:[]};
const count=tests.addImported(state,'materials',[{id:'a',title:'New text',text:'今日は図書館で日本語を勉強します。'}]);
assert.ok(count>0);
assert.equal(state.materialTests[0].locale,'ja-JP');
assert.equal(state.materialTests[0].id,'a');
console.log('PASS: English/Japanese grounded questions, answer grading, empty input, one-word book, import-triggered tests');
