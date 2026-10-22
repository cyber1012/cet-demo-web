/**
 * AI 批改速度自测
 *
 * 用户要求：「3 秒以内能做到吗？完成之前自测一遍能行吗？」
 * 这个脚本用真实模型、真实批改负载，跑 3 次取中位数，
 * 验证优化后的实际耗时，而不是靠感觉。
 */

// ===== 最小浏览器环境，载入真实 ai.js =====
global.window = {};
global.document = { querySelector: () => null, createElement: () => ({}) };

// CDN SDK 替身：用原生 fetch 走同一网关
global.window.WorkBuddyCloud = {
  createWorkBuddyCloud({ endpoint, publishableKey }) {
    return {
      llm: {
        models: { async list() { return [{ id: 'auto' }]; } },
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
                  body: JSON.stringify({ model, messages, stream: true, temperature, reasoning_effort: 'none' }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const reader = res.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                let first = 0;
                const t0 = Date.now();
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
                      const o = JSON.parse(p);
                      if (o.choices?.[0]?.delta?.content) {
                        if (!first) first = Date.now() - t0;
                        yield o;
                      }
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

// ai.js 里 cloud.js 需要 window.WorkBuddyCloud 与 window.__wbCloud
global.window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window.scrollTo = () => {};

async function main() {
  const ai = await import('../web/js/ai.js');
  if (!global.window.__wbCloud) {
    // ai.js 内部通过 getCloud() 初始化 cloud.js，这里手动补上
    const cloudMod = await import('../web/js/cloud.js');
    cloudMod.getCloud();
  }

  const essay = `Nowadays, more and more college students think that time management is not important.
They think they have much time, so they can play games every day.
In my opinion, this is a wrong idea. Time management plays a crucial role in our study.
First of all, if we manage time well, we can finish our task more effective.
Also, time management can help us reduce pressure before exam.
Therefore, we should learn to manage our time. We can use the Pomodoro Technique.
In conclusion, time management is very important for every college student.`;

  console.log('AI 批改速度自测');
  console.log('='.repeat(58));
  console.log('负载：一篇 93 词的四级作文（含典型语法错误）');
  console.log('模型：自动择优（探测后取最快可用）\n');

  // 预热：模拟真实用户路径（页面加载时就探测好模型）
  console.log('预热中...');
  const tw = Date.now();
  const picked = await ai.warmup();
  console.log('预热完成，选用模型：' + picked +'（耗时 '+((Date.now()-tw)/1000).toFixed(1)+'s）\n');

  const times = [];
  let lastResult = null;

  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    try {
      lastResult = await ai.reviewEssay({ essay, taskType: null, level: 'CET4' });
      const ms = Date.now() - t0;
      times.push(ms);
      console.log(`第 ${i} 次：${(ms / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`第 ${i} 次失败：${e.message}`);
    }
  }

  if (!times.length) {
    console.log('\n全部失败，无法自测');
    process.exit(1);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;

  console.log('\n' + '='.repeat(58));
  console.log(`最快 ${(Math.min(...times) / 1000).toFixed(1)}s`);
  console.log(`中位 ${(median / 1000).toFixed(1)}s`);
  console.log(`平均 ${(avg / 1000).toFixed(1)}s`);

  if (lastResult) {
    console.log('\n批改结果有效性：');
    console.log(`  分数：${lastResult.score}/15`);
    console.log(`  主题：${(lastResult.detectedTopic || '').slice(0, 40)}`);
    console.log(`  维度数：${lastResult.dimensions?.length}（应为 4）`);
    console.log(`  语法错误：${lastResult.grammarErrors?.length} 条`);
    console.log(`  中式表达：${lastResult.chineseExpressions?.length} 条`);
  }

  console.log('\n' + '='.repeat(58));
  const pass = median <= 3000;
  console.log(
    pass
      ? `✓ 中位 ${(median / 1000).toFixed(1)}s，达到 3 秒目标`
      : `✗ 中位 ${(median / 1000).toFixed(1)}s，未达 3 秒`
  );
  console.log('='.repeat(58));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('自测异常：', e.message);
  process.exit(1);
});