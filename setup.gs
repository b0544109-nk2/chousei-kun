/**
 * 調整くんっ！｜セットアップ用 Apps Script
 *
 * 使い方（1回だけ）:
 *   1. https://script.google.com/ で「新しいプロジェクト」を作り、このファイルの中身を全部貼る
 *   2. 関数の選択で setup を選んで「実行」→ Googleの許可画面で許可する
 *   3. 実行ログに出た「シートID」を Claude に伝える（config.js を作ってサイトにつなぎます）
 *
 * 作られるもの:
 *   - スプレッドシート「調整くんっ！（データ）」… タブ「募集」「回答」「設定」
 *   - フォーム2つ（募集用・回答用）… サイトが裏で送信する内部用。人が直接開くものではありません
 *   - スプレッドシートの共有を「リンクを知っている全員が閲覧可」に設定
 *
 * 注意:
 *   - タブの名前とフォームの質問の文言は変えないでください（サイトが名前で探しています）
 *   - シートは誰でも読める設定です。名前と回答以外（メールアドレス・電話番号など）は書かないでください
 *   - 2回実行すると、シートとフォームがもう1組できます（古いほうは消してOK）
 */

const SETUP = {
  title: '調整くんっ！',
  pageUrl: 'https://b0544109-nk2.github.io/chousei-kun/',
};

/**
 * 【プレビューを1〜2分で出すための追加設定】（1回だけ）
 *   GitHubの5分ごとの自動実行は実際には数時間おきにしか動かないので、
 *   シートに募集が届いた瞬間に GitHub へ「ページを作って」と知らせる。
 *
 *   1. GitHub で fine-grained のトークンを作る
 *      https://github.com/settings/personal-access-tokens/new
 *      - Repository access: Only select repositories → b0544109-nk2/chousei-kun だけ
 *      - Permissions → Repository permissions → Contents: Read and write（ほかは触らない）
 *      - 有効期限は1年など。できた github_pat_… をコピー
 *   2. この Apps Script の左の歯車「プロジェクトの設定」→ いちばん下「スクリプト プロパティ」→
 *      「プロパティを追加」で  プロパティ: GITHUB_TOKEN  値: さっきのトークン  → 保存
 *   3. 関数の選択で enableQuickPreview を選んで実行 → 許可 → ログに「✅」と出ればOK
 *   トークンの期限が切れたら、2 の値を新しいものに変えるだけでよい。
 */
const GITHUB_REPO = 'b0544109-nk2/chousei-kun';

function enableQuickPreview() {
  const book = newestBook_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onSheetSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetSubmit').forSpreadsheet(book).onFormSubmit().create();
  const code = dispatch_();
  Logger.log(code === 204
    ? '✅ 設定しました。これから募集が届くたびに、1〜2分でプレビュー用ページができます（対象: ' + book.getName() + '）'
    : '⚠ GitHub に知らせられませんでした（HTTP ' + code + '）。トークンの権限（Contents: Read and write）と対象リポジトリを確認してください');
}

// シートにフォームの回答が届いたとき（トリガーから呼ばれる）。募集タブのときだけ GitHub に知らせる
function onSheetSubmit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === '募集') dispatch_();
}

function dispatch_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('スクリプト プロパティに GITHUB_TOKEN がありません（上の説明の 2 を参照）');
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'sheet' }),
    muteHttpExceptions: true,
  });
  return res.getResponseCode();
}

// いちばん新しい「調整くんっ！（データ）」（ゴミ箱のものは除く）
function newestBook_() {
  const files = DriveApp.getFilesByName(SETUP.title + '（データ）');
  let newest = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
  }
  if (!newest) throw new Error('「' + SETUP.title + '（データ）」が見つかりません。setup をもう一度実行してください。');
  return SpreadsheetApp.openById(newest.getId());
}

// フォームの質問（回答シートの列は A:タイムスタンプ、B〜D がこの順）
const EVENT_Q = { id: '募集ID', kind: '種類', body: '内容' };
const ANSWER_Q = { id: '募集ID', key: '名前キー', body: '回答' };

function setup() {
  const ss = SpreadsheetApp.create(SETUP.title + '（データ）');
  const ssId = ss.getId();

  const fe = buildForm_(SETUP.title + '｜募集（内部用・直接開かない）', EVENT_Q, 'body');
  const fa = buildForm_(SETUP.title + '｜回答（内部用・直接開かない）', ANSWER_Q, 'body');

  fe.form.setDestination(FormApp.DestinationType.SPREADSHEET, ssId);
  fa.form.setDestination(FormApp.DestinationType.SPREADSHEET, ssId);
  SpreadsheetApp.flush();

  const book = SpreadsheetApp.openById(ssId);
  const evSheet = findResponseSheet_(ssId, fe.form).setName('募集');
  const anSheet = findResponseSheet_(ssId, fa.form).setName('回答');

  const config = {
    sheetId: ssId,
    base: SETUP.pageUrl,
    forms: {
      event: entries_(fe),
      answer: entries_(fa),
    },
  };

  const settings = book.getSheets().filter(s => !s.getFormUrl())[0] || book.insertSheet();
  settings.setName('設定');
  settings.getRange(1, 1, 6, 2).setValues([
    ['項目', '値'],
    ['シートID', ssId],
    ['公開ページ', SETUP.pageUrl],
    ['config', JSON.stringify(config)],
    ['募集フォーム（編集用）', fe.form.getEditUrl()],
    ['メモ', 'このスプシは「リンクを知っている全員が閲覧可」です。タブ名とフォームの質問は変えないでください。'],
  ]);
  settings.setColumnWidth(1, 160).setColumnWidth(2, 720).setFrozenRows(1);

  // タブの並べ替えは見た目だけなので、失敗しても先に進む
  try { [settings, evSheet, anSheet].forEach((s, i) => { book.setActiveSheet(s); book.moveActiveSheet(i + 1); }); } catch (e) {}
  // ※回答タブ（フォームとつながったタブ）の列の書式は変えない。複数列をまとめて変えると
  //   「列単位の操作を行うには…」のエラーで止まる。中身はJSONなので書式を変えなくても化けない

  shareAndLog_(book, config);
}

/**
 * setup が途中で止まったとき用（「列単位の操作を行うには…」のエラーなど）。
 * いちばん新しい「調整くんっ！（データ）」を探して、共有設定とログ出力だけをやり直す。
 * シートとフォームは作り直さないので、二重にできない。
 */
function finish() {
  const files = DriveApp.getFilesByName(SETUP.title + '（データ）');
  let newest = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
  }
  if (!newest) throw new Error('「' + SETUP.title + '（データ）」が見つかりません。setup をもう一度実行してください。');
  const book = SpreadsheetApp.openById(newest.getId());
  const settings = book.getSheetByName('設定');
  const row = settings && settings.getDataRange().getValues().find(r => r[0] === 'config');
  if (!row) throw new Error('設定タブに config がありません。このスプレッドシートとフォーム2つをゴミ箱に入れて、setup をもう一度実行してください。');
  shareAndLog_(book, JSON.parse(row[1]));
}

function shareAndLog_(book, config) {
  let shared = true;
  try {
    DriveApp.getFileById(book.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    shared = false;
  }
  Logger.log([
    '✅ セットアップ完了',
    'シートID: ' + book.getId(),
    'スプレッドシート: ' + book.getUrl(),
    shared ? '共有設定: リンクを知っている全員が閲覧可にしました'
           : '⚠ 共有設定を変更できませんでした。スプシの「共有」→「リンクを知っている全員」→「閲覧者」にしてください',
    '',
    '↓ config.js の中身（Claude に「シートID」だけ伝えればOK）',
    'window.SOROU_CONFIG = ' + JSON.stringify(config, null, 2) + ';',
  ].join('\n'));
}

function buildForm_(title, questions, paragraphKey) {
  const f = FormApp.create(title);
  f.setDescription('「調整くんっ！」のサイトから自動で送られる内部用のフォームです。直接回答しないでください。');
  try { f.setCollectEmail(false); } catch (e) {}
  try { f.setLimitOneResponsePerUser(false); } catch (e) {}
  try { f.setShowLinkToRespondAgain(false); } catch (e) {}
  publish_(f);
  // 選択肢の不一致で送信が弾かれないよう、すべて自由記述にする
  const items = {};
  Object.keys(questions).forEach(k => {
    items[k] = k === paragraphKey ? f.addParagraphTextItem().setTitle(questions[k])
                                  : f.addTextItem().setTitle(questions[k]);
  });
  return { form: f, items: items };
}

function publish_(f) {
  try { if (typeof f.setPublished === 'function') f.setPublished(true); } catch (e) {}
  f.setAcceptingResponses(true);
}

// 送信先URLと entry 番号（公開ページのHTMLにある本当の番号。item.getId() とは別物）
function entries_(built) {
  const publishedUrl = built.form.getPublishedUrl();
  const idMap = extractAnswerIds_(publishedUrl);
  const out = { action: publishedUrl.replace(/\/viewform.*$/, '/formResponse'), entries: {} };
  Object.keys(built.items).forEach(k => {
    const id = idMap[built.items[k].getId()];
    if (!id) throw new Error('entry番号を特定できませんでした: ' + built.items[k].getTitle());
    out.entries[k] = 'entry.' + id;
  });
  return out;
}

function extractAnswerIds_(publishedUrl) {
  const html = UrlFetchApp.fetch(publishedUrl, { followRedirects: true, muteHttpExceptions: true }).getContentText();
  const m = html.match(/FB_PUBLIC_LOAD_DATA_ = ([\s\S]*?);\s*<\/script>/);
  if (!m) throw new Error('フォームの構造を読み取れませんでした（FB_PUBLIC_LOAD_DATA_ が見つかりません）');
  const map = {};
  JSON.parse(m[1])[1][1].forEach(it => { if (it[4] && it[4][0]) map[it[0]] = it[4][0][0]; });
  return map;
}

function findResponseSheet_(ssId, form) {
  const formId = form.getId();
  for (let i = 0; i < 10; i++) {
    const hit = SpreadsheetApp.openById(ssId).getSheets().find(s => {
      const url = s.getFormUrl();
      if (!url) return false;
      if (url.indexOf(formId) >= 0) return true;
      try { return FormApp.openByUrl(url).getId() === formId; } catch (e) { return false; }
    });
    if (hit) return hit;
    Utilities.sleep(1500);
  }
  throw new Error('フォームの回答シートが見つかりませんでした：' + form.getTitle());
}
