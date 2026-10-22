/**
 * AI 批改页 —— 产品的核心
 * 三个模式：作文 / 翻译 / 口语
 * 目标：让学生看清「我差在哪」，而不是只看到一个分数。
 */
import {
  state, persist, SPEAKING_TASKS,
  go, toast, ai,
} from './app.js';
import { judgeWordCount, countWords, getEssayWords, LEVEL_LABEL } from './grading-levels.js';

let mode = 'write';     // write | translate | speak
let speakIdx = 0;      // 仅口语使用
let essay = '';
let translation = '';
let transSource = '';   // 汉译英原文（可选，折叠填写）
let showSource = false; // 原文输入框是否展开
let transcript = '';
let result = null;
let loading = false;
let streaming = '';
let mediaStream = null;
let recognition = null;
let recTimer = null;
let recSeconds = 0;
let recording = false;
let recognizedFinal = ''; // 已确认的识别文本（防止重复累加）
let ocrBusy = false;      // 图片转录中

/**
 * 线性相机图标（内联 SVG）。
 *
 * 不用 emoji：emoji 在不同系统上字形差异极大（iOS 是彩色相机，
 * Windows 是老式相机），和整体克制的线性风格完全不符。
 * SVG 则是自己画的，任何设备上完全一致。
 */
const CAMERA_ICON = `<svg class="capture-ico" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 10 3.7h4a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45h1.9A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>
  <circle cx="12" cy="13" r="3.6"/>
</svg>`;

/**
 * 压缩图片：手机随手拍的照片有 3-5MB，必须压到 200KB 内才能快速上传。
 * 策略：限制最长边 1600px（识别英文足够），JPEG 质量 0.82。
 */
function compressImage(file, maxEdge = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        let { width, height } = img;
        // 等比缩放
        if (width > height && width > maxEdge) {
          height = Math.round((height * maxEdge) / width);
          width = maxEdge;
        } else if (height > maxEdge) {
          width = Math.round((width * maxEdge) / height);
          height = maxEdge;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // 白底，避免透明 PNG 变黑影响识别
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 按当前考试等级筛选题库：仅口语需要（口语必须有题目） */
function levelTasks(list) {
  const lv = state.examLevel === 'CET4' ? 'CET4' : 'CET6';
  const filtered = list.filter((t) => t.level === lv);
  return filtered.length ? filtered : list;
}

export function renderReview(root) {
  // 作文与翻译不再用题库；只有口语按等级选题
  const speaks = levelTasks(SPEAKING_TASKS);
  if (speakIdx >= speaks.length) speakIdx = 0;
  // 已经填过原文就保持展开，否则用户会看不到自己填的内容
  if (transSource) showSource = true;
  const body = document.createElement('div');
  body.className = 'view';
  root.innerHTML = '';
  root.appendChild(body);

  const paint = () => {
    body.innerHTML = `
      <header class="flex between mt-lg mb-lg" style="align-items:flex-end">
        <h1 class="display">批改</h1>
        <span class="label">AI REVIEW</span>
      </header>

      <div class="seg mb-lg">
        ${[
          ['write', '作文'],
          ['translate', '翻译'],
          ['speak', '口语'],
        ]
          .map(
            ([k, t]) =>
              `<button class="seg-item ${mode === k ? 'on' : ''}" data-mode="${k}">${t}</button>`
          )
          .join('')}
      </div>

      ${mode === 'write' ? writePane() : mode === 'translate' ? transPane() : speakPane()}

      ${loading ? loadingPane() : ''}
    `;

    bind(body);
  };

  // ===== 作文 =====
  function writePane() {
  const wc = essay.trim() ? essay.trim().split(/\s+/).length : 0;
  const lv = state.examLevel === 'CET4' ? 'CET4' : 'CET6';
  const std = getEssayWords(lv);
  const range = `${std.min}-${std.max} 词`;
  // 实时状态：让用户在提交前就知道词数是否达标（纯本地计算）
  const wcView = wc > 0 ? judgeWordCount(wc, lv) : null;
  const last = (state.aiHistory || []).find((h) => h.kind === 'write');

  return `
      <!-- 评分口径卡：替代原来的题目卡，告诉你 15分怎么来 -->
      <section class="card-grad g-violet mb-md">
        <div class="flex between center">
          <span class="label" style="color:rgba(15,15,14,.5)">${lv} · ${range}</span>
          <span class="label" style="color:rgba(15,15,14,.45)">当前 ${wc} 词${wcView ? ' · ' + wcView.label.replace(/（.*?）/, '') : ''}</span>
        </div>
        <p class="title mt-sm" style="font-size:22px">写你自己的题，我来批</p>
        <p class="body mt-sm" style="color:rgba(15,15,14,.62)">
          用你自己的作文题目。AI 会先读懂文章在讲什么，再按四六级标准打分。
        </p>

        <div class="dims mt-md">
          ${[['内容充实度', '论证是否具体'], ['结构逻辑', '衔接与层次'], ['语言表达', '语法与用词'], ['格式规范', '字数与段落']]
            .map(
              ([n, d]) => `
            <div class="dim">
              <span class="dim-n">${n}</span>
              <span class="dim-d">${d}</span>
            </div>`
            )
            .join('')}
        </div>
      </section>

      ${
        last
          ? `<div class="last-review mb-md">
               <span class="last-n">${last.score}<span class="last-d">/15</span></span>
               <div class="grow">
                 <p class="label">上次批改</p>
                 <p class="caption muted">${timeAgo(last.time)}</p>
               </div>
             </div>`
          : ''
      }

      <!-- 拍照上传：写在纸上是主要场景 -->
      <div class="capture mb-md">
        <input type="file" accept="image/*" capture="environment" class="capture-input" id="essayImg" />
        <label class="capture-btn" for="essayImg">
          ${CAMERA_ICON}
          <span>${ocrBusy ? '正在识别…' : '拍照 / 上传手写作文'}</span>
        </label>
        <p class="capture-tip">草稿纸、试卷、笔记本都行 · 拿不准的字会标 [?] 让你确认</p>
      </div>

      <textarea class="field mb-md" id="essay" rows="10"
        placeholder="在这里写下你的作文，或直接拍照上传…">${esc(essay)}</textarea>

      <button class="btn btn-primary btn-block mb-lg" data-act="submit-write" ${loading ? 'disabled' : ''}>
        ${loading ? '批改中…' : '提交批改'}
      </button>

      <section class="mb-lg">
        <p class="label mb-sm">高频扣分点</p>
        <div class="flex wrap gap-xs">
          ${['中式表达', '词数不足', '模板套话', '副词误用', '主谓不一致']
            .map((t) => `<span class="tag">${t}</span>`)
            .join('')}
        </div>
      </section>
    `;
  }

  // ===== 翻译 =====
function transPane() {
  const lv = state.examLevel === 'CET4' ? 'CET4' : 'CET6';
  // 翻译按译文质量评分（语义/语法/要点/中式直译/表达效果），不看字数。
  // 原先这里写「140-160 汉字 / 180-200 汉字」是原文长度要求，
  // 放在译文输入区会误导成「译文要写多少字」。
  const range = '按译文质量评分';
  const last = (state.aiHistory || []).find((h) => h.kind === 'translate');

    return `
      <section class="card-grad g-mint mb-md">
        <div class="flex between center">
          <span class="label" style="color:rgba(15,15,14,.5)">汉译英 · ${lv} · ${range}</span>
        </div>
        <p class="title mt-sm" style="font-size:22px">写下译文，我按标准评</p>
        <p class="body mt-sm" style="color:rgba(15,15,14,.62)">
          拍照或直接输入译文。有原文时能评准度，没有也能评语言质量。
        </p>

        <div class="dims mt-md">
          <div class="dim">
            <span class="dim-n">译文准度</span>
            <span class="dim-d">错译漏译扣分</span>
          </div>
          <div class="dim">
            <span class="dim-n">通顺流畅</span>
            <span class="dim-d">用词与表达</span>
          </div>
        </div>
      </section>

      ${
        last
          ? `<div class="last-review mb-md">
               <span class="last-n">${last.score}<span class="last-d">/15</span></span>
               <div class="grow">
                 <p class="label">上次批改</p>
                 <p class="caption muted">${timeAgo(last.time)}</p>
               </div>
             </div>`
          : ''
      }

      <!-- 拍照上传：一次拍全，原文与译文分别识别 -->
      <div class="capture mb-md">
        <input type="file" accept="image/*" capture="environment" class="capture-input" id="transImg" />
        <label class="capture-btn" for="transImg">
          ${CAMERA_ICON}
          <span>${ocrBusy ? '正在识别…' : '拍照识别原文与译文'}</span>
        </label>
        <p class="capture-tip">整页拍一张即可，中英文会自动分开填入</p>
      </div>

      <!-- 译文：主输入区 -->
      <p class="label mb-sm">我的译文（必填）</p>
      <textarea class="field mb-md" id="trans" rows="7"
        placeholder="写下你的英译文，或拍照上传…">${esc(translation)}</textarea>

      <!-- 原文：折叠。默认不占位，需要评「准度」时才展开。
           拍照识别会自动填好，一般不需要手动写。 -->
      <div class="mb-md">
        <button class="link-toggle" data-act="toggle-source">
          ${transSource ? '原文已填 · 点击编辑' : '需要评准度？手动补充原文'}
        </button>
        ${
          showSource
            ? `<textarea class="field mt-sm" id="transSource" rows="4"
                placeholder="粘贴或输入汉译英原文…">${esc(transSource)}</textarea>`
            : ''
        }
      </div>

      <button class="btn btn-primary btn-block mb-lg" data-act="submit-trans" ${loading ? 'disabled' : ''}>
        ${loading ? '翻译中…' : '即刻翻译'}
      </button>

      <section class="mb-lg">
        <p class="label mb-sm">翻译高频扣分</p>
        <div class="flex wrap gap-xs">
          ${['错译漏译', '中式搭配', '时态错误', '词汇单调', '语序不当']
            .map((t) => `<span class="tag">${t}</span>`)
            .join('')}
        </div>
      </section>
    `;
  }

  // ===== 口语 =====
  function speakPane() {
    const list = speaks;
    const t = list[speakIdx];
    const rec = recording;
    return `
      <section class="card-grad g-mint mb-md">
        <p class="label" style="color:rgba(15,15,14,.5)">${t.type} · ${t.level}</p>
        <h2 class="title mt-sm">${esc(t.topic)}</h2>
        <p class="body mt-sm" style="color:rgba(15,15,14,.68)">${esc(t.hint)}</p>
      </section>

      <div class="picker mb-md">
        ${list.map((x, i) => `<button class="picker-i ${i === speakIdx ? 'on' : ''}" data-speak="${i}">${i + 1}</button>`).join('')}
      </div>

      <div class="rec-wrap mb-lg">
        <div class="rec-pulse ${rec ? 'on' : ''}"></div>
        <button class="rec-btn ${rec ? 'on' : ''}" data-act="rec">
          <span class="rec-time">${rec ? `${recSeconds}s` : 'start'}</span>
        </button>
        <p class="rec-tip">${
          rec
            ? '正在听… 点击结束'
            : recognition
              ? '点击开始录音（说完自动转文字）'
              : '当前浏览器不支持语音识别，可直接手动输入'
        }</p>
      </div>

      <textarea class="field mb-md" id="tr" rows="5"
        placeholder="你的回答会显示在这里，也可以直接输入…">${esc(transcript)}</textarea>

      <button class="btn btn-primary btn-block mb-lg" data-act="score-speak" ${loading ? 'disabled' : ''}>
        ${loading ? 'AI 评分中…' : '开始评分'}
      </button>
    `;
  }

/**
 * 加载浮层
 * 关键设计：不显示死板的转圈，而是让用户看到批改在推进。
 * 服务端首字节约 1.4s（无法消除），但流式输出期间有持续反馈，
 * 体感就从「卡住了」变成「正在工作」。
 */
let loadStart = 0;
let loadTimer = null;
let loadStage = '';

function startLoading(stage) {
  loadStart = Date.now();
  loadStage = stage;
}

function loadingPane() {
  const secs = loadStart ? Math.floor((Date.now() - loadStart) / 1000) : 0;
  return `
    <div class="sheet-mask" style="display:flex;align-items:center;justify-content:center">
      <div class="loading-card">
        <div class="loader">
          <span></span><span></span><span></span>
        </div>
        <p class="mt-md">${esc(loadStage || '正在批改…')}</p>
        <p class="loading-sub" id="loadHint">${secs < 2 ? '预计 3-8 秒' : `已等待 ${secs} 秒`}</p>
${streaming ? `<pre class="loading-stream">${esc(streaming.slice(-140))}</pre>` : ''}
        </div>
      </div>`;
}

function tickLoading() {
  clearInterval(loadTimer);
  loadTimer = setInterval(() => {
    const el = document.getElementById('loadHint');
    if (!el) return clearInterval(loadTimer);
    const secs = Math.floor((Date.now() - loadStart) / 1000);
    el.textContent = secs < 2 ? '预计 3-8 秒' : `已等待 ${secs} 秒…`;
  }, 1000);
}

  // ===== 事件绑定 =====
  function bind(el) {
    el.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        result = null;
        paint();
      })
    );

    el.querySelectorAll('[data-speak]').forEach((b) =>
      b.addEventListener('click', () => {
        speakIdx = Number(b.dataset.speak);
        result = null;
        paint();
      })
    );

    const es = el.querySelector('#essay');
    if (es) es.addEventListener('input', (e) => (essay = e.target.value));

    const tr = el.querySelector('#trans');
    if (tr) tr.addEventListener('input', (e) => (translation = e.target.value));

    const src = el.querySelector('#transSource');
    if (src) src.addEventListener('input', (e) => (transSource = e.target.value));

    const tp = el.querySelector('#tr');
    if (tp) tp.addEventListener('input', (e) => (transcript = e.target.value));

    /** 通用图片转录处理：识别 → 填入指定字段 */
    async function handleImage(inputId, target, label) {
      const input = el.querySelector(`#${inputId}`);
      if (!input) return;
      input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        ocrBusy = true;
        paint();
        try {
          const base64 = await compressImage(file);
          const r = await ai.transcribeImage(base64);
          // 全部呈现在输入框里，用户自己修改后提交
          if (target === 'essay') {
            essay = essay ? `${essay}\n\n${r.text}` : r.text;
          } else if (target === 'trans') {
            translation = translation ? `${translation}\n\n${r.text}` : r.text;
          } else if (target === 'source') {
            transSource = transSource ? `${transSource}\n${r.text}` : r.text;
          }
          if (r.uncertain > 0) {
            toast(`识别完成，${r.uncertain} 处拿不准（已标 [?]），请核对`);
          } else {
            toast(`${label}识别完成，请核对`);
          }
        } catch (err) {
          const msg =
            err.message === 'ocr_empty'
              ? '没识别到英文，请手动输入'
              : /sdk_not_loaded/.test(err.message)
                ? 'AI 组件未加载，请刷新页面'
                : ai.explainError(err);
          toast(msg);
        } finally {
          ocrBusy = false;
          paint();
        }
        const again = el.querySelector(`#${inputId}`);
        if (again) again.value = '';
      });
    }

    handleImage('essayImg', 'essay', '作文');

    // 翻译：一次拍照分别识别原文与译文，各自填入对应框
    const transImg = el.querySelector('#transImg');
    if (transImg) {
      transImg.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        ocrBusy = true;
        paint();
        try {
          const base64 = await compressImage(file);
          const r = await ai.transcribeTranslationSheet(base64);
          // 原文与译文分别落到各自位置，无需手动复制
          if (r.source) {
            transSource = transSource ? `${transSource}\n${r.source}` : r.source;
            // 识别到原文就自动展开原文框 —— 用户需要看到识别结果并核对
            showSource = true;
          }
          if (r.translation) {
            translation = translation ? `${translation}\n${r.translation}` : r.translation;
          }
          if (r.uncertain > 0) {
            toast(`识别完成，${r.uncertain} 处拿不准（已标 [?]），请核对`);
          } else {
            toast(`识别完成：原文${r.source ? '✓' : '无'} · 译文${r.translation ? '✓' : '无'}`);
          }
        } catch (err) {
          const msg =
            err.message === 'ocr_empty'
              ? '没识别到中英文内容，请手动输入'
              : /sdk_not_loaded/.test(err.message)
                ? 'AI 组件未加载，请刷新页面'
                : ai.explainError(err);
          toast(msg);
        } finally {
          ocrBusy = false;
          paint();
        }
        const again = el.querySelector('#transImg');
        if (again) again.value = '';
      });
    }

    el.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.act))
    );
  }

  // ===== 动作 =====
  async function act(a) {
    if (a === 'submit-write') return submitWrite();
    if (a === 'submit-trans') return submitTrans();
    if (a === 'rec') return toggleRec();
    if (a === 'score-speak') return scoreSpeak();
    if (a === 'toggle-source') {
      showSource = !showSource;
      paint();
      return;
    }
  }

  async function submitWrite() {
    if (essay.trim().length < 20) return toast('作文太短，至少写几句');
    const lv = state.examLevel === 'CET4' ? 'CET4' : 'CET6';
    loading = true;
    streaming = '';
    startLoading('正在按四六级标准批改…');
    paint();
    tickLoading();

    try {
      // 不传题目：AI 先读懂文章主题，再按四维度评分
      result = await ai.reviewEssay({
        essay,
        taskType: null,
        level: lv,
        wordLimit: `${getEssayWords(lv).min}-${getEssayWords(lv).max} 词`,
        onDelta: (_, full) => {
          streaming = full;
        },
      });
      pushHistory('write', result.detectedTopic || '作文批改', result);
      markTaskDone('review');
    } catch (e) {
      toast(ai.explainError(e));
    } finally {
      loading = false;
      streaming = '';
      clearInterval(loadTimer);
      paint();
      if (result) showResult(withDetailFlag(result, { essay, transSource, translation }));
    }
  }

  async function submitTrans() {
    if (!translation.trim()) return toast('请先写下你的译文');
    loading = true;
    streaming = '';
    startLoading('正在批改译文…');
    paint();
    tickLoading();

    try {
      result = await ai.reviewTranslation({
        source: transSource,
        translation,
        level: state.examLevel === 'CET4' ? 'CET4' : 'CET6',
        onDelta: (_, full) => {
          streaming = full;
        },
      });
      pushHistory('translate', transSource ? '汉译英批改' : '译文批改', result);
    } catch (e) {
      toast(ai.explainError(e));
    } finally {
      loading = false;
      streaming = '';
      clearInterval(loadTimer);
      paint();
      if (result) showResult(withDetailFlag(result, { essay: transcript, transSource, translation }));
    }
  }

  async function toggleRec() {
    if (recording) {
      recognition?.stop();
      return;
    }
    if (!recognition) {
      toast('当前浏览器不支持语音识别，请手动输入');
      body.querySelector('#tr')?.focus();
      return;
    }

    try {
      transcript = '';
      recognizedFinal = '';
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;

      /**
       * 语音识别的结果处理。
       *
       * 之前的实现有严重 bug：每次 onresult 都把新内容追加到 transcript，
       * 但流式识别会反复触发同一个 resultIndex 区间的结果，
       * 导致同一句话被重复累加（用户反馈出现了
       * 「This This crap This crap your…」这种重复文本）。
       *
       * 正确做法：维护一个「已确认文本」变量，每次从**全部 results 重建**
       * 最终文本，而不是增量追加。这样天然幂等，重复触发也不会产生重复。
       */
      recognition.onresult = (e) => {
        let finalAll = '';
        let interimAll = '';
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalAll += r[0].transcript + ' ';
          else interimAll += r[0].transcript;
        }
        // 以isFinal 的累积为基准，未确认的临时结果只用于实时预览
        recognizedFinal = cleanTranscript(finalAll);
        transcript = interimAll
          ? (recognizedFinal + ' ' + interimAll).trim()
          : recognizedFinal;

        const ta = body.querySelector('#tr');
        if (ta) ta.value = transcript;
      };

      recognition.onerror = (e) => {
        toast(e.error === 'not-allowed' ? '请允许麦克风权限' : '识别出错，可手动输入');
        stopRec();
      };

      recognition.onend = () => {
        if (recording) stopRec();
      };

      // 部分浏览器需要先拿到麦克风流才肯启动识别
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recognition.start();

      recording = true;
      recSeconds = 0;
      recTimer = setInterval(() => {
        recSeconds++;
        const t = body.querySelector('.rec-time');
        if (t) t.textContent = `${recSeconds}s`;
        if (recSeconds >= 120) recognition.stop();
      }, 1000);

      paint();
    } catch (e) {
      toast('无法访问麦克风，请检查权限设置');
    }
  }

  function stopRec() {
    recording = false;
    clearInterval(recTimer);
    recTimer = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    if (transcript.trim()) {
      toast('识别完成，可以评分了');
    }
    paint();
  }

  // 初始化语音识别（浏览器支持检测）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      recognition = new SR();
    } catch (e) {
      recognition = null;
    }
  }

  async function scoreSpeak() {
    if (!transcript.trim()) return toast('请先录音或输入你的回答');
    const t = levelTasks(SPEAKING_TASKS)[speakIdx];
    loading = true;
    streaming = '';
    startLoading('正在按四六级标准批改…');
    paint();
    tickLoading();

    try {
      result = await ai.evaluateSpeaking({
        transcript,
        topic: t.topic,
        durationSec: recSeconds || 30,
        onDelta: (_, full) => {
          streaming = full;
        },
      });
      pushHistory('speak', t.topic, result);
      markTaskDone('review');
    } catch (e) {
      toast(ai.explainError(e));
    } finally {
      loading = false;
      streaming = '';
      clearInterval(loadTimer);
      paint();
      if (result) showResult(withDetailFlag(result, { essay: transcript, transSource, translation }));
    }
  }

  function pushHistory(kind, title, r) {
    state.aiHistory.unshift({ kind, title, score: r.score, time: Date.now() });
    state.aiHistory = state.aiHistory.slice(0, 50);
    persist();
  }

  function markTaskDone(k) {
    const key = todayKeyLocal();
    state.tasks[key] = state.tasks[key] || {};
    state.tasks[key][k] = true;
    persist();
  }

  paint();
}

// ===== 结果浮层 =====
function showResult(r) {
  // 记住当前滚动位置：详情加载后内容变长，重绘时要保持视口不跳
  const prevSheet = document.querySelector('.sheet');
  const prevTop = prevSheet ? prevSheet.scrollTop : 0;

  document.querySelector('.sheet-mask')?.remove();
  document.querySelector('.sheet')?.remove();

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';

  const kind = r.__kind || (r.dimensions?.length === 5 ? 'speak' : r.accuracy ? 'translate' : 'write');
  const label = kind === 'speak' ? '口语测试得分' : kind === 'translate' ? '翻译得分' : '作文得分';

  sheet.innerHTML = `
    <div class="flex between center mb-lg">
      <div class="flex" style="align-items:baseline;gap:2px">
        <span class="numeral">${r.score}</span>
        <span class="faint" style="font-weight:600">/15</span>
      </div>
      <span class="label">${label}</span>
    </div>

    <div class="mb-lg">
      ${(r.dimensions || [])
        .map(
          (d) => `
        <div class="mb-md">
          <div class="flex between" style="align-items:baseline">
            <span class="body" style="color:var(--ink);font-weight:600">${esc(d.name)}</span>
            <span class="subtitle">${d.score}<span class="faint" style="font-size:12px">/${d.max}</span></span>
          </div>
          <div class="bar mt-xs">
            <div class="bar-fill" style="width:${(d.score / d.max) * 100}%"></div>
          </div>
          <p class="caption mt-xs muted">${esc(d.comment || '')}</p>
        </div>`
        )
        .join('')}
    </div>

    ${r.wordCount ? wordBlock(r) : ''}
    ${listBlock('中式英语表达', r.chineseExpressions, 'warn')}
    ${listBlock('模板套话', r.templateCliches, 'warn')}
    ${errBlock('语法错误', r.grammarErrors)}
    ${r.accuracy ? textBlock('准度', r.accuracy) : ''}
    ${r.fluency ? textBlock('通顺度', r.fluency) : ''}
    ${errBlock('问题清单', r.errors)}
    ${listBlock('中式发音特征', r.chineseAccent, 'warn')}
    ${listBlock('发音纠正', r.pronunciation?.map((p) => `${p.word} → ${p.correct}`), 'warn')}
    ${upBlock(r.highScoreSentences || r.upgradeSentences)}
    ${listBlock('亮点', r.strengths, 'good')}
    ${r.upgrade ? textBlock('参考译文', r.upgrade, true) : ''}
    ${r.modelAnswer ? textBlock('满分参考回答', r.modelAnswer, true) : ''}

    ${
      r.nextStep ? nextBlock(r.nextStep) : ''
    }
    ${
      r.detailPending
        ? `<button class="btn btn-ghost btn-block mt-md" data-act="detail" ${r.detailLoading ? 'disabled' : ''}>
             ${r.detailLoading ? '正在生成详细点评…' : '看详细点评与升级表达'}
           </button>`
        : ''
    }

    <button class="btn btn-primary btn-block mt-lg" id="closeSheet">继续练习</button>
  `;

  document.body.appendChild(mask);
  document.body.appendChild(sheet);

  // 恢复滚动位置（仅在有内容变长时才需要）
  if (prevTop > 0) sheet.scrollTop = prevTop;

  const close = () => {
    mask.remove();
    sheet.remove();
  };
  mask.addEventListener('click', close);
  sheet.querySelector('#closeSheet').addEventListener('click', close);

  // 看详细：按需请求，不拖慢首屏
  const detailBtn = sheet.querySelector('[data-act="detail"]');
  if (detailBtn) {
    detailBtn.addEventListener('click', async () => {
      // 用局部状态标记，避免整表重绘（重绘会让浮层闪烁并丢失滚动位置）
      r.detailLoading = true;
      detailBtn.disabled = true;
      detailBtn.textContent = '正在生成详细点评…';

      // 重绘一次以进入 loading 态
      showResult(r);

      try {
        const isEssay = !!r.__essayText;
        const extra = isEssay
          ? await ai.reviewEssayDetail({ essay: r.__essayText })
          : await ai.reviewTranslationDetail({ source: r.__source, translation: r.__transText });
        Object.assign(r, extra);

        // 关键：清掉「待加载」标志与原文缓存。
        // 若不清，showResult 重绘后按钮会再次出现 → 点了又请求 → 死循环。
        r.detailPending = false;
        r.detailLoading = false;
        r.__essayText = '';
        r.__source = '';
        r.__transText = '';

        showResult(r);
      } catch (e) {
        r.detailLoading = false;
        r.detailPending = true;
        showResult(r);
        toast(ai.explainError(e));
      }
    });
  }
}

/**
 * 词数提示块 —— **完全由本地代码判定**，不依赖 AI。
 *
 * 之前的 bug：调用处是 `${r.wordCount ? wordBlock(r) : ''}`，
 * 只要作文有词数就无条件显示「词数不足，已降档」，根本没做范围判断。
 * 于是出现过「AI 评语说符合要求、界面却红字说词数不足」的自相矛盾。
 *
 * 现在按当前考试等级的及格线判定，达标时不显示任何警告。
 */
function wordBlock(r) {
  const count = Number(r.wordCount) || 0;
  if (count <= 0) return '';
  const v = judgeWordCount(count, state.examLevel);
  // 达标时不加警告块，避免虚惊
  if (v.status === 'ok' && v.inSafe) return '';
  return `
    <div class="blk">
      <p class="blk-t ${v.tone}">${esc(v.label)}</p>
      <p class="body muted">${esc(v.tip)}</p>
    </div>`;
}

function listBlock(title, arr, tone) {
  if (!arr || !arr.length) return '';
  return `
    <div class="blk">
      <p class="blk-t ${tone === 'warn' ? 'warn' : 'good'}">${title}</p>
      <div class="flex wrap gap-xs">
        ${arr.map((x) => `<span class="tag tag-${tone === 'warn' ? 'warn' : 'good'}">${esc(typeof x === 'string' ? x : x.word + ' → ' + x.correct)}</span>`).join('')}
      </div>
    </div>`;
}

function errBlock(title, arr) {
  if (!arr || !arr.length) return '';
  return `
    <div class="blk">
      <p class="blk-t">${title}</p>
      ${arr
        .map(
          (g) => `
        <div class="err">
          <div class="err-top">
            <span class="err-o">${esc(g.original || '')}</span>
            ${g.type ? `<span class="tag tag-info">${esc(g.type)}</span>` : ''}
          </div>
          <div class="err-c">${esc(g.corrected || '')}</div>
          <p class="caption muted">${esc(g.explain || '')}</p>
        </div>`
        )
        .join('')}
    </div>`;
}

function upBlock(arr) {
  if (!arr || !arr.length) return '';
  return `
    <div class="blk">
      <p class="blk-t">升级表达</p>
      ${arr
        .map(
          (s) => `
        <div class="up">
          <div class="up-row"><span class="up-tag">你的</span><span class="up-o">${esc(s.origin)}</span></div>
          <div class="up-row"><span class="up-tag hi">6分</span><span class="up-u">${esc(s.upgrade)}</span></div>
          <p class="caption muted mt-xs">${esc(s.reason || '')}</p>
        </div>`
        )
        .join('')}
    </div>`;
}

function textBlock(title, text, isLong) {
  if (!text) return '';
  return `
    <div class="blk">
      <p class="blk-t">${title}</p>
      <p class="body ${isLong ? '' : 'muted'}">${esc(text)}</p>
    </div>`;
}

function nextBlock(t) {
  return `
    <div class="card-grad g-lime blk">
      <p class="label" style="color:rgba(15,15,14,.5)">下一步</p>
      <p class="body mt-xs" style="color:var(--ink);font-weight:600">${esc(t)}</p>
    </div>`;
}

// ===== 工具 =====
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function todayKeyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 清洗语音识别文本。
 *
 * 两道处理：
 *  1. 相邻重复词：「This This crap」→ 「This crap」
 *  2. 非相邻的短语重复：「This crap your This crap your favorite」
 *     浏览器识别会把同一段话重复吐出多次，且不保证相邻，
 *     因此需要检测「短语 A隔若干词后又出现A」的情况并去掉后一次。
 *
 * 之所以要第2 步：用户实际反馈的重复形态是整句重复（间隔 3-4 词），
 * 只做相邻去重解决不了。
 */
function cleanTranscript(text) {
  let words = String(text).trim().split(/\s+/).filter(Boolean);

  // 1) 相邻重复词
  const step1 = [];
  for (const w of words) {
    const key = keyOf(w);
    const prev = step1.length ? keyOf(step1[step1.length - 1]) : null;
    if (key && key === prev) continue;
    step1.push(w);
  }
  words = step1;

  // 2) 短语级重复：若已出现过的短语再次出现，且中间间隔很小，视为重复
  for (let len = Math.min(6, Math.floor(words.length / 2)); len >= 2; len--) {
    const seen = new Set();
    for (let i = 0; i + len <= words.length; i++) {
      const phrase = words.slice(i, i + len).map(keyOf).join(' ');
      if (!phrase) continue;
      if (seen.has(phrase)) {
        // 找到此前出现的位置，若距离不远则判定为识别器重复
        const prevIdx = [...seen].indexOf(phrase);
        if (prevIdx !== -1 && i - prevIdx <= len * 2 + 2) {
          words.splice(i, len);
          i -= len;
        }
        continue;
      }
      seen.add(phrase);
    }
  }

  return words.join(' ');
}

function keyOf(w) {
  return String(w).toLowerCase().replace(/[^a-z0-9']/g, '');
}

/** 相对时间：用于「上次批改 2 天前」 */
function withDetailFlag(r, ctx) {
  // 快速批改不含升级表达等次要字段，需要用户点「看详细」时再请求
  return Object.assign(r, {
    detailPending: true,
    __essayText: ctx.essay || '',
    __source: ctx.transSource || '',
    __transText: ctx.translation || '',
  });
}

/** 相对时间：用于「上次批改 2 天前」 */
function timeAgo(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) {
    const h = Math.floor((Date.now() - ts) / 3600000);
    if (h <= 0) {
      const m = Math.max(1, Math.floor((Date.now() - ts) / 60000));
      return `${m} 分钟前`;
    }
    return `${h} 小时前`;
  }
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  return `${Math.floor(d / 30)} 个月前`;
}