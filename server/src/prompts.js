'use strict';
const fs = require('fs');
const path = require('path');
const { formatTranscript, hhmm } = require('./store');

const MAX_TRANSCRIPT_CHARS = 150000;
const MAX_MATERIALS_CHARS = 60000;

function context(s, config) {
  const internal = s.type === 'internal';
  const lines = [
    `- 会議の種類: ${internal ? '社内会議' : '社外の商談'}`,
    `- 会議名: ${s.title}`,
    `- 日付: ${new Date(s.createdAt).toLocaleDateString('ja-JP')}`,
  ];
  if (!internal) lines.push(`- 顧客名: ${s.customer || '（未入力。文字起こしから判断）'}`);
  if (config.myCompany) lines.push(`- 自社名: ${config.myCompany}`);
  if (s.memo) lines.push(`- ${internal ? '会議の目的・議題' : '担当者メモ'}: ${s.memo}`);
  if (s.mode === 'offline') {
    lines.push('- 形式: 対面。1台のPCのマイクで室内の全員の声を拾っているため、字幕の話者名はすべて同じ人物になっています。発言者は文脈から推測し、推測の場合は「（推定）」と書いてください。');
  } else if (internal) {
    lines.push('- 形式: オンライン会議（Google Meet）。話者名は Meet の表示名で、「あなた」「You」はこのメモの利用者です。');
  } else {
    lines.push('- 形式: オンライン商談（Google Meet）。話者名は Meet の表示名で、「あなた」「You」は自社側の担当者（このメモの利用者）です。');
  }
  return lines.join('\n');
}

const COMMON_RULES = `- 文字起こしは自動字幕なので誤変換を含みます。文脈から補正してください。
- 発言にないことを推測で書かないでください。確信のない固有名詞・金額・日付には「(要確認)」を付けてください。
- 前置き・後書き・挨拶は書かず、指定の形式だけを出力してください。`;

const SUMMARY_FORMAT = {
  sales: `## この区間の要点
- （3〜6項目）

## 合意・決定事項（累積）
- （なければ「なし」）

## 認識合わせが必要な点
- 金額・期限・範囲・担当・前提条件などがあいまいなまま進んだ点を、その場で相手に聞ける「〜という理解でよろしいでしょうか？」の形で書く（なければ「なし」）

## 宿題・ToDo（累積）
- [担当] 内容（期限）

## 顧客の課題・ニーズ（累積）
- 

## 次に聞いておくべきこと
- `,
  internal: `## この区間の要点
- （3〜6項目）

## 決定事項（累積）
- （なければ「なし」）

## 認識合わせが必要な点
- 担当・期限・範囲・前提があいまいなまま進んだ点を、その場で確認できる「〜ということでよいですか？」の形で書く（なければ「なし」）

## ネクストアクション（累積）
- [担当] 内容（期限）　※担当や期限が決まっていなければ「担当未定」「期限未定」と書く

## 未決事項・持ち越しの論点（累積）
- （なければ「なし」）`,
};

function summaryPrompt(s, newSegments, prevSummary, config) {
  const internal = s.type === 'internal';
  const from = newSegments.length ? hhmm(newSegments[0].firstSeen) : '';
  const to = newSegments.length ? hhmm(newSegments[newSegments.length - 1].lastUpdated) : '';
  return `${internal
    ? 'あなたは社内会議に同席している書記です。進行中の会議の要点を定期的にまとめ、参加者どうしの認識のずれや、ネクストアクションの抜け漏れを防ぐのが役割です。'
    : 'あなたは商談に同席している営業アシスタントです。進行中の商談の要点を定期的にまとめ、参加者どうしの認識のずれを防ぐのが役割です。'}

# 会議情報
${context(s, config)}

# 前回までのまとめ
${prevSummary || '（まだありません。これが最初のまとめです）'}

# 今回の区間の文字起こし（${from}〜${to}）
${formatTranscript(newSegments)}

# 指示
前回までのまとめと今回の区間をあわせて、次の形式の Markdown を出力してください。「（累積）」の項目は前回までの内容も引き継いで更新してください。
${COMMON_RULES}

${SUMMARY_FORMAT[internal ? 'internal' : 'sales']}
`;
}

function trimTranscript(s) {
  let t = formatTranscript(s.segments);
  if (t.length > MAX_TRANSCRIPT_CHARS) {
    t = '（前半は長いため省略。途中経過のまとめを参照してください）\n…\n' + t.slice(-MAX_TRANSCRIPT_CHARS);
  }
  return t;
}

function summariesBlock(s) {
  const ok = s.summaries.filter((x) => x.markdown);
  if (!ok.length) return '（なし）';
  return ok.map((x) => `### まとめ ${x.index}（${hhmm(x.createdAt)}時点）\n${x.markdown}`).join('\n\n');
}

function minutesPrompt(s, config) {
  if (s.type === 'internal') return internalMinutesPrompt(s, config);
  return `あなたは営業担当者の優秀なアシスタントです。終了した商談の議事録を作成してください。

# 商談情報
${context(s, config)}

# 会議中に作成した途中経過のまとめ
${summariesBlock(s)}

# 文字起こし全文
${trimTranscript(s)}

# 指示
次の形式の Markdown を出力してください。
${COMMON_RULES}

# 議事録: （会議名）
## 基本情報
- 日時 / 顧客 / 参加者（字幕から分かる範囲）

## 商談の概要
（3行程度）

## 顧客の現状と課題

## 主な議論内容

## 合意・決定事項

## 認識合わせが必要な点（次回の冒頭やメールで確認）

## 宿題・ToDo
| 担当 | 内容 | 期限 |
|---|---|---|

## 次回に向けて
- 次回の目的、提案の方向性、準備するもの

## お客様への確認メール（文案）
（本日のお礼、合意事項・宿題・確認したい点を簡潔にまとめた、そのまま送れる丁寧なビジネスメール）
`;
}

function internalMinutesPrompt(s, config) {
  return `あなたは社内会議の優秀な書記です。終了した会議の議事録とネクストアクションをまとめてください。

# 会議情報
${context(s, config)}

# 会議中に作成した途中経過のまとめ
${summariesBlock(s)}

# 文字起こし全文
${trimTranscript(s)}

# 指示
次の形式の Markdown を出力してください。
${COMMON_RULES}
- ネクストアクションは抜け漏れがないように、発言の中の「やっておきます」「確認します」「次回までに」なども拾ってください。担当・期限が決まっていないものは「未定」と書き、決めるべきことがわかるようにしてください。

# 議事録: （会議名）

## 基本情報
- 日時:
- 参加者:（字幕から分かる範囲）
- 目的・議題:

## サマリー
（3行程度）

## 議論内容
### （議題・話題ごとに見出しを立てる）
- 

## 決定事項
- 

## 未決事項・次回への持ち越し
- 

## 認識合わせが必要な点
- （担当・期限・範囲などがあいまいなまま終わった点）

## ネクストアクション
| # | 担当 | 内容 | 期限 | 備考 |
|---|---|---|---|---|

## 共有用まとめ（チャット貼り付け用）
（会議に出ていない人にも伝わるように、決定事項とネクストアクションを5〜8行で）
`;
}

function loadMaterials(dir) {
  if (!dir || !fs.existsSync(dir)) return '';
  const out = [];
  let total = 0;
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      const f = path.join(d, name);
      const st = fs.statSync(f);
      if (st.isDirectory()) walk(f);
      else if (/\.(md|txt|csv)$/i.test(name) && total < MAX_MATERIALS_CHARS) {
        const body = fs.readFileSync(f, 'utf8').slice(0, MAX_MATERIALS_CHARS - total);
        total += body.length;
        out.push(`### ${path.relative(dir, f)}\n${body}`);
      }
    }
  };
  walk(dir);
  return out.join('\n\n');
}

function proposalPrompt(s, minutesMd, materials, config) {
  return `あなたは法人営業のトップセールスです。商談の議事録と自社資料をもとに、次回の商談で使う提案書（Google スライド）の構成と文言を作ってください。

# 商談情報
${context(s, config)}

# 議事録
${minutesMd}

# 自社資料（製品・サービス・料金・事例など）
${materials || '（資料なし。自社の具体的なサービス名・金額は書かず、【要確認】としてください）'}

# 指示
- 顧客が話した課題・言葉を起点に、「課題 → 解決策 → 効果 → 進め方 → 次のステップ」の流れで 6〜9 枚にしてください（表紙は title / subtitle から自動で作るので slides には含めない）。
- slides の1枚目は「前回の振り返り（認識合わせ）」にしてください。前回の合意事項と認識合わせが必要な点を載せ、冒頭で確認できるようにします。
- 自社資料にない金額・実績・機能は作らず、【要確認】と書いてください。
- bullets は1枚あたり最大5項目、1項目は全角40文字以内。
- notes には、そのスライドで話す内容や、相手に投げかける質問を書いてください。
- 出力は次の JSON だけにしてください（コードブロックや説明文は不要）。

{
  "title": "提案書のタイトル",
  "subtitle": "〇〇株式会社 御中 / YYYY年MM月DD日",
  "slides": [
    { "title": "スライドの見出し", "lead": "このスライドで一番伝えたい一文", "bullets": ["要点"], "notes": "話すときのメモ" }
  ]
}
`;
}

function parseProposal(text) {
  let t = String(text).replace(/```(?:json)?/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('提案の JSON が見つかりません');
  const obj = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(obj.slides) || !obj.slides.length) throw new Error('slides が空です');
  obj.title = String(obj.title || 'ご提案書');
  obj.subtitle = String(obj.subtitle || '');
  obj.slides = obj.slides.map((sl) => ({
    title: String(sl.title || ''),
    lead: String(sl.lead || ''),
    bullets: (Array.isArray(sl.bullets) ? sl.bullets : []).map(String).slice(0, 8),
    notes: String(sl.notes || ''),
  }));
  return obj;
}

module.exports = { summaryPrompt, minutesPrompt, proposalPrompt, parseProposal, loadMaterials };
