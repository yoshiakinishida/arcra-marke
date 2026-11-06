#!/usr/bin/env node
// テスト用の claude 代替。引数と環境変数を検証し、プロンプトの種類に応じた出力を返す
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (process.env.ANTHROPIC_API_KEY) { console.error('API key leaked'); process.exit(3); }
  if (!process.argv.includes('-p')) process.exit(4);
  if (input.includes('"slides"')) {
    console.log('```json\n' + JSON.stringify({
      title: 'テスト提案', subtitle: 'テスト株式会社 御中',
      slides: [
        { title: '前回の振り返り', lead: '認識合わせ', bullets: ['予算は500万円(要確認)'], notes: '確認する' },
        { title: '課題', lead: '属人化', bullets: ['a', 'b'], notes: '' },
      ],
    }) + '\n```');
  } else if (input.includes('打ち合わせのメモを作成')) {
    console.log('# 打ち合わせメモ: 特許相談\n## 1. 結論（3行）\n- 出願は約50万円');
  } else if (input.includes('社内会議の優秀な書記')) {
    console.log('# 社内議事録: 週次定例\n## ネクストアクション\n| # | 担当 | 内容 | 期限 | 備考 |');
  } else if (input.includes('議事録を作成')) {
    console.log('# 議事録: テスト\n## 合意・決定事項\n- 次回は来週');
  } else {
    console.log('## この区間の要点\n- ' + (input.match(/\] ([^:\n]+): ([^\n]+)/) || ['', '', ''])[2]);
  }
});
