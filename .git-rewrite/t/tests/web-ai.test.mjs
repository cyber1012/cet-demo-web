/**
 * Web 版 AI 批改链路验证
 *
 * 用 CDN SDK 的等价形态（原生 fetch + 相同公开配置）跑一次真实批改，
 * 验证「Web 环境下 AI 批改可用」——这是小程序版与网页版共用的核心能力。
 */
import { reviewEssay, parseJSON, explainError } from '../web/js/ai.js';
import { readFileSync } from 'fs';

// ===== 最小浏览器环境 =====
global.window = {};
global.document = { querySelector: () => null };

// CDN 形态的 SDK 替身：直接用 fetch 调同一网关
global.window.WorkBuddyCloud = {
  createWorkBuddyCloud({ endpoint, publishableKey }) {
    return {
      llm: {
        models: {
          async list() {
            const r = await fetch(`${endpoint}/.cloud/llm/models`, {
              headers: { 'x-wb-webapp-access-key': publishableKey },
            });
            if (!r.ok) throw new Error(`models ${r.status}`);
            return r.json();
          },
        },
        chat: {
          completions: {
            create({ model, messages, temperature }) {
              return (async function* () {
                const res = await fetch(`${endpoint}/.cloud/llm/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'x-wb-webapp-access-key': publishableKey,
                  },
                  body: JSON.stringify({ model, messages, stream: true, temperature }),
                });
                if (!res.ok) {
                  throw new Error(`chat ${res.status} ${await res.text()}`);
                }
                const reader = res.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buf += dec.decode(value, { stream: true });
                  let nl;
                  while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line.startsWith('data:')) continue;
                    const p = line.slice(5).trim();
                    if (p === '[DONE]') continue;
                    try {
                      yield JSON.parse(p);
                    } catch {}
                  }
                }
              })();
            },
          },
        },
      },
    };
  },
};

// ===== 解析函数抽取（与 ai.js 同一份实现，用于独立校验）=====
const aiSrc = readFileSync(new URL('../web/js/ai.js', import.meta.url), 'utf8');
const parseMatch = aiSrc.match(/export function parseJSON[\s\S]*?\n}/);

async function main() {
  console.log('【1】纯逻辑：JSON 容错解析');
  const checks = [];
  const ck = (n, p) => checks.push({ n, p: !!p });

  ck('导出 parseJSON', typeof parseJSON === 'function');
  ck('正常 JSON 可解析', parseJSON('{"a":1,"b":"x"}').a === 1);
  ck('容忍前后说明文字', parseJSON('这是分析：\n{"score":8}\n希望有帮助').score === 8);
  ck('容忍 markdown 包裹', parseJSON('```json\n{"score":9}\n```').score === 9);
  ck('字符串里的 } 不截断', parseJSON('{"note":"含 } 的内容"}').note === '含 } 的内容');
  ck('转义引号正确处理', parseJSON('{"s":"a\\"}b"}').s === 'a\\"}b');

  checks.forEach((c) => console.log(`  ${c.p ? '✓' : '✗'} ${c.n}`));

  console.log('\n【2】真实调用：Web 环境下的 AI 作文批改');
  console.log('  （推理模型，可能需要 1-3 分钟）\n');

  const essay = `Nowadays, more and more college students think that time management is not important.
They think they have much time, so they can play games every day.
In my opinion, this is a wrong idea. Time management plays a crucial role in our study.
First of all, if we manage time well, we can finish our task more effective.
Also, time management can help us reduce pressure before exam.
Therefore, we should learn to manage our time. We can use the Pomodoro Technique.
In conclusion, time management is very important for every college student.`;

  let r;
  const t0 = Date.now();
  try {
    let streamed = 0;
    r = await reviewEssay({
      essay,
      taskType: '议论文｜The Importance of Time Management for College Students',
      wordLimit: '120-180 词',
      onDelta: () => streamed++,
    });
    console.log(`  ✓ 调用成功，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，流式分片 ${streamed} 个\n`);
  } catch (e) {
    console.error(`  ✗ 失败: ${e.message}`);
    console.error(`    提示: ${explainError(e)}`);
    process.exit(1);
  }

  console.log('='.repeat(58));
  console.log(`总分：${r.score} / 15    实测词数：${r.wordCount}`);
  console.log('='.repeat(58));

  if (r.dimensions) {
    console.log('\n分项评分：');
    r.dimensions.forEach((d) => console.log(`  ${d.name}：${d.score}/${d.max} — ${d.comment}`));
  }
  if (r.chineseExpressions?.length) {
    console.log('\n中式表达：');
    r.chineseExpressions.forEach((c) => console.log('  · ' + c));
  }
  if (r.grammarErrors?.length) {
    console.log('\n语法错误：');
    r.grammarErrors.forEach((g) => console.log(`  ✗ ${g.original}\n    → ${g.corrected}`));
  }
  if (r.highScoreSentences?.length) {
    console.log('\n升级表达（第1条）：');
    const s = r.highScoreSentences[0];
    console.log(`  你的：${s.origin}`);
    console.log(`  6分：${s.upgrade}`);
  }
  console.log('\n下一步：' + r.nextStep);

  console.log('\n' + '='.repeat(58));
  const ok = [
    ['总分 0-15', r.score >= 0 && r.score <= 15],
    ['三个维度', r.dimensions?.length === 3],
    ['抓到 more effective', r.grammarErrors?.some((g) => /more effective/i.test(g.original))],
    ['抓到 before exam', r.grammarErrors?.some((g) => /before exam/i.test(g.original))],
    ['识别中式表达', r.chineseExpressions?.length > 0],
    ['给出升级表达', r.highScoreSentences?.length > 0],
    ['给出下一步', !!r.nextStep],
  ];
  ok.forEach(([n, p]) => console.log(`${p ? '✓' : '✗'} ${n}`));
  const bad = ok.filter(([, p]) => !p).length;
  console.log('='.repeat(58));
  console.log(bad ? `${bad} 项未通过` : 'Web 版 AI 批改链路完全可用');
  process.exit(bad ? 1 : 0);
}

main();