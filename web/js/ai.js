/**
 * AI 批改 / 口语评分 · Web 版
 *
 * 评分标准严格对齐大学英语四、六级考试官方评分体系（与小程序版共用同一套提示词）。
 * 平台差异只有一处：Web 走 CDN SDK，小程序走 npm子路径。
 */
import { getCloud } from './cloud.js';
import { getEssayWords, LEVEL_LABEL, countWords } from './grading-levels.js';

// ===== 四六级作文官方评分体系（满分 15 分）=====
const WRITING_RUBRIC = `
【大学英语四六级作文评分标准 CET-4/CET-6 · 满分15分】
官方采用「整体评分法」(Holistic Scoring)，从三个维度综合评定，不按错误数量机械扣分：

1. 切题程度 (Tr Relevance)：是否扣住题目要求、是否有独到立意
   - 优秀(5分)：紧扣题意，立意新颖，论述充分
   - 良好(3-4分)：基本切题，论据支撑尚可
   - 一般(1-2分)：偏离题意或论述空洞
   - 不及格(0分)：文不对题

2. 篇章结构 (Organization)：三段式框架是否完整、衔接是否自然
   - 优秀(5分)：结构严谨，衔接手段多样（however/therefore/meanwhile等）
   - 良好(3-4分)：结构清晰，衔接基本自然
   - 一般(1-2分)：结构松散，缺少衔接
   - 不及格(0分)：无结构可言

3. 语言能力 (Language Ability)：词汇丰富度、句式多样性、语法准确度
   - 优秀(5分)：词汇句式多样，基本无语言错误
   - 良好(3-4分)：用词较丰富，个别小错
   - 一般(1-2分)：句式单一，错误较多影响理解
   - 不及格(0分)：大量语言错误

【阅卷教师关注点】
- 中式英语表达（individual think / very important等冗余）
- 模板痕迹过重（句式雷同、开头结尾套话堆砌）
- 时态一致性、主谓一致
`;

// ===== 四六级口语评分体系 =====
const SPEAKING_RUBRIC = `
【大学英语四六级口语考试评分标准 · 满分15分】
官方五大维度：

1. 语音 (Pronunciation, 3分)：音准、语调、连读
2. 词汇 (Vocabulary, 3分)：词汇丰富度与准确度
3. 语法 (Grammatical Accuracy, 3分)：句法结构与时态一致性
4. 话题相关性 (Topic Relevance, 3分)：是否紧扣话题、内容是否充实
5. 流利度与连贯性 (Fluency & Coherence, 3分)：语速自然、表达连贯

【常扣分项】
中式音韵（th读成s/z、v读成w/l、词尾辅音吞音）
中式句式（"I very like" / "according to my opinion"）
缺冠词缺介词
搭配错误（open light / learn knowledge）
`;

/**
 * 模型选择：实测择优，不写死单一模型。
 *
 * 背景（实测数据，见 tests/speed.test.mjs）：
 *  - `auto` 路由稳定命中重度推理模型，首字 1.6-3.2s，总耗时常超 10s，且**不可控**
 *  - 具名模型可用（此前 400 是因为带了 response_format，去掉后正常）
 *  - 实测首字延迟（同一真实批改任务）：
 *      deepseek-v4.1-flash  1141ms  总 3.2s  ← 最快且 JSON 完整
 *      hunyuan-chat          1022ms  总 6.3s
 *      mimo-v2.6-pro         1534ms  总 7.5s
 *      space-bunny          6700ms  总 12.0s
/**
 * 模型选择：实测择优 + 预热
 *
 * 实测数据（同一真实四级批改任务的总耗时）：
 *   deepseek-v4.1-flash  3.2s  ← 最快
 *   hunyuan-chat          6.3s
 *   mimo-v2.6-pro         7.5s
 *   space-bunny          12.0s
 *   auto 路由             8-10s 且不可控（会命中重度推理模型）
 * 部分模型（glm-4.6 / minimax-m2.5）目录里有但实际返回空，必须探测。
 *
 * 关键优化：预热。若等用户提交时才探测，首次批改必然慢 9s+；
 * 因此页面加载时就后台探测好。
 */
const FAST_MODELS = ['deepseek-v4.1-flash', 'hunyuan-chat', 'mimo-v2.6-pro'];
const PROBE_MAX_MS = 4500;
const CACHE_TTL = 60 * 60 * 1000;

let cachedModelId = null;
let cachedAt = 0;
let warming = null;

async function probeModel(cloud, id) {
  const t0 = Date.now();
  let out = '';
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: id,
      messages: [
        { role: 'system', content: '只输出JSON，第一个字符必须是{，最后一个必须是}。' },
        { role: 'user', content: '输出 {\"ok\":1}' },
      ],
      stream: true,
      temperature: 0.3,
      reasoning_effort: 'none',
    })) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) out += d;
      if (Date.now() - t0 > PROBE_MAX_MS) break;
    }
  } catch (e) {
    return null;
  }
  if (!out || out.trim().length < 4) return null;
  return { id, ms: Date.now() - t0 };
}

/** 页面加载时预热，把模型选定结果缓存下来 */
export function warmup() {
  if (cachedModelId) return Promise.resolve(cachedModelId);
  if (warming) return warming;
  warming = (async () => {
    try {
      const cloud = getCloud();
      for (const id of FAST_MODELS) {
        const r = await probeModel(cloud, id);
        if (r) { cachedModelId = r.id; cachedAt = Date.now(); return r.id; }
      }
      cachedModelId = 'auto';
    } catch (e) {
      cachedModelId = 'auto';
    }
    cachedAt = Date.now();
    return cachedModelId;
  })();
  return warming;
}

async function getModel(cloud) {
  if (cachedModelId && Date.now() - cachedAt < CACHE_TTL) return { id: cachedModelId };
  await warmup();
  return { id: cachedModelId || 'auto' };
}

/**
 * 调用模型并收集完整文本
 *
 * 性能关键：
 *  1. reasoning_effort:'none' 必须传 ——不加时 auto 会命中推理模型，
 *     实测首字等99 秒、推理分片 6074 个（正式内容仅 12 字符）。
 *  2. 使用预热选中的快速模型。
 *  3. 失败或返回空自动降级到 auto 重试。
 */
async function askModel({ system, prompt, temperature = 0.6, onDelta }) {
  const cloud = getCloud();
  const model = await getModel(cloud);
  let answer = '';
  let got = false;
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: model.id,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: true,
      temperature,
      reasoning_effort: 'none',
    })) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) { answer += delta; got = true; if (onDelta) onDelta(delta, answer); }
    }
  } catch (e) {
    if (model.id !== 'auto' && !got) {
      cachedModelId = 'auto'; cachedAt = Date.now();
      return askModel({ system, prompt, temperature, onDelta });
    }
    throw e;
  }
  if (!answer.trim() && model.id !== 'auto') {
    cachedModelId = 'auto'; cachedAt = Date.now();
    return askModel({ system, prompt, temperature, onDelta });
  }
  if (!answer.trim()) throw new Error('empty_response');
  return answer;
}

// ===== AI 作文批改 =====
/**
 * 批改不依赖题目，且**默认走精简输出以保证速度**。
 *
 * 速度实测（deepseek-v4.1-flash，同一真实批改）：
 *   完整版 1148 字符 → 5.0s
 *   精简版 612 字符   → 2.6s
 * 输出长度直接决定生成时间，省掉次要字段能省一半。
 *
 * 因此：默认只返回「分数 + 四维度 + 最多3 条错误 + 下一步」，
 * 升级表达、模板套话、亮点等放到 detail 模式（用户点"看详细"时才请求）。
 *
 * @param {boolean} detail 是否返回完整字段
 */
export async function reviewEssay({ essay, taskType, level, wordLimit, detail = false, onDelta }) {
  const lv = level || (/CET6|六级/.test(taskType || '') ? 'CET6' : 'CET4');
  const hasTask = !!taskType && !/（无题目|未提供题目|无题）/.test(taskType);

  // 词数标准来自 grading-levels.js（唯一来源），按当前等级动态注入。
  // 不再让 AI 自己猜该用四级还是六级标准 —— 之前提示词里写死两套，
  // 会导致「AI 说符合要求、界面说词数不足」这种自相矛盾。
  const std = getEssayWords(lv);
  const lvLabel = LEVEL_LABEL[lv] || '四级';
  const range = wordLimit || `${std.min}-${std.max} 词`;

  const system =
    `你是${lv === 'CET6' ? '大学英语六级' : '大学英语四级'}阅卷教师，严格按照官方评分标准批改学生作文。` +
    '你的回答必须是一个完整的 JSON 对象，不要包含任何解释文字，不要用 markdown 代码块包裹。' +
    '第一个字符必须是 {，最后一个字符必须是 }。';

  const taskBlock = hasTask
    ? `
【本次作文题目】
${taskType}
「内容充实度」评估：是否扣住题目、论证是否充分展开。
`
    : `
【重要：学生未提供作文题目】
这很常见——学生只是把自己写的文章拿过来求批改。请：
1. 先判断这篇文章自己在讲什么（主题与立意），填入 detectedTopic
2. 「内容充实度」评估：**论点是否具体、有无展开、论据是否支撑观点**
3. **不要因为没有题目而扣分，也不要在 comment 里说「缺少题目」**
`;

  // 字段配置：精简版 vs 完整版
  const FIELDS = detail
    ? `  "chineseExpressions": ["中式英语表达"],
  "grammarErrors": [{"original": "原句片段", "corrected": "修改后", "explain": "为什么错"}],
  "templateCliches": ["模板套话"],
  "strengths": ["亮点1"],
  "highScoreSentences": [{"origin": "你写的那句", "upgrade": "更高分的写法", "reason": "提升点"}],
  "nextStep": "下一步最该改进的一件事"`
    : `  "grammarErrors": [{"original": "原句片段", "corrected": "修改后", "explain": "为什么错，最多2条"}],
  "chineseExpressions": ["中式英语表达，最多2条"],
  "nextStep": "下一步最该改进的一件事"`;

  const prompt =
    WRITING_RUBRIC +
    taskBlock +
    `
【评分维度】满分 15 分，四项综合评定：
1. 内容充实度 —— 论点是否明确、论证是否具体展开
2. 结构逻辑 —— 段落划分、衔接手段、结论是否呼应开头
3. 语言表达 —— 语法准确度、词汇丰富度、中式表达
4. 格式规范 —— 字数是否符合 ${range}、段落数

【词数要求（${lvLabel}）】
- 及格区间：${std.min}-${std.max} 词
- 稳妥区间：${std.safeMin}-${std.safeMax} 词（篇幅控制得更好）
- 当前按 **${lvLabel}** 标准评分，不要套用另一级别的数字。

注意：字数的达标判定由本地程序完成，你的职责是在「格式规范」维度里
**评价篇幅的合理性**（如开头是否空泛、段落是否均衡、有无注水），
不要在 comment 里重复播报字数是否达标，避免与界面提示矛盾。

【学生作文】
"""
${essay}
"""

请严格按以下 JSON 结构输出（**维度的 name 与所有文字必须用中文**）：
{
  "score": 总分数字(0-15，可含0.5),
  "detectedTopic": "文章主题（一句话中文）",
  "dimensions": [
    {"name": "内容充实度", "score": 数字, "max": 5, "comment": "一句话点评，中文"},
    {"name": "结构逻辑", "score": 数字, "max": 5, "comment": "一句话点评，中文"},
    {"name": "语言表达", "score": 数字, "max": 5, "comment": "一句话点评，中文"},
    {"name": "格式规范", "score": 数字, "max": 5, "comment": "一句话点评，中文"}
  ],
  "wordCount": 实际词数数字,
${FIELDS}
}`;

  const result = parseJSON(await askModel({ system, prompt, temperature: 0.5, onDelta }));

  // 词数以本地统计为准，不采信模型返回的数字。
  // 字数是确定性的：AI 可能数错，而它只用于展示与后续判定，
  // 必须 100% 准确。若模型没返回或返回非数字，也用本地值补上。
  if (result && typeof result === 'object') {
    result.wordCount = countWords(essay);
  }

  // 兜底：模型偶尔会用英文维度名，统一映射回中文
  const DIM_MAP = {
    内容充实度: '内容充实度', content: '内容充实度', contentfulness: '内容充实度',
    结构逻辑: '结构逻辑', organization: '结构逻辑', structure: '结构逻辑',
    语言表达: '语言表达', language: '语言表达', accuracy: '语言表达',
    格式规范: '格式规范', format: '格式规范',
  };
  if (Array.isArray(result.dimensions)) {
    result.dimensions = result.dimensions.map((d) => ({
      ...d,
      name: DIM_MAP[String(d.name || '').trim().toLowerCase()] || d.name,
    }));
  }
  return result;
}

/** 详细批改：只补齐升级表达等次要字段，不重复打分 */
export async function reviewEssayDetail({ essay }) {
  const system =
    '你是四级/六级阅卷教师。只输出JSON，第一个字符必须是{，最后一个字符必须是}。';
  const prompt = `以下是学生的一篇英语作文，请找出其中可以升级为高分表达的地方。

【学生作文】
"""
${essay}
"""

输出 JSON：
{
  "highScoreSentences": [
    {"origin": "原文里写得一般的句子", "upgrade": "6分档改写", "reason": "提升点"},
    {"origin": "...", "upgrade": "...", "reason": "..."},
    {"origin": "...", "upgrade": "...", "reason": "..."}
  ],
  "strengths": ["亮点1", "亮点2"],
  "templateCliches": ["文中用到的模板套话1"]
}`;

  const r = parseJSON(await askModel({ system, prompt, temperature: 0.6 }));
  return {
    highScoreSentences: r.highScoreSentences || [],
    strengths: r.strengths || [],
    templateCliches: r.templateCliches || [],
  };
}

// ===== AI 口语评分 =====
export async function evaluateSpeaking({ transcript, topic, durationSec, onDelta }) {
  const system =
    '你是一位有十年经验的大学英语四六级口语测试员，严格按照官方评分标准对学生口语表现打分并纠音。' +
    '你的回答必须是一个完整的 JSON 对象，不要包含任何解释文字，也不要用 markdown 代码块包裹。' +
    '第一个字符必须是 {，最后一个字符必须是 }。';

  const prompt =
    SPEAKING_RUBRIC +
    `
【题目】${topic}
【录音时长】${durationSec} 秒
【语音转写内容】
"""
${transcript}
"""

请严格按以下 JSON 结构输出：
{
  "score": 总分数字(0-15的整数，可含0.5),
  "dimensions": [
    {"name": "语音", "score": 数字(0-3), "max": 3, "comment": "一句话点评"},
    {"name": "词汇", "score": 数字(0-3), "max": 3, "comment": "一句话点评"},
    {"name": "语法", "score": 数字(0-3), "max": 3, "comment": "一句话点评"},
    {"name": "话题相关性", "score": 数字(0-3), "max": 3, "comment": "一句话点评"},
    {"name": "流利度与连贯性", "score": 数字(0-3), "max": 3, "comment": "一句话点评"}
  ],
  "pronunciation": [{"word": "读错的词", "correct": "正确音标", "tip": "怎么改口型"}],
  "chineseAccent": ["中式发音特征1", "..."],
  "grammarFixes": [{"original": "原句", "corrected": "改法", "explain": "原因"}],
  "upgradeSentences": [{"origin": "你原来的表达", "upgrade": "6分档表达", "reason": "提升点"}],
  "modelAnswer": "该题目的满分参考回答（口语风格）",
  "nextStep": "下一步最该改进的一件事"
}`;

  return parseJSON(await askModel({ system, prompt, temperature: 0.5, onDelta }));
}

// ===== 翻译批改 =====
/**
 * 同作文：有原文评「准度+通顺度」，无原文则只评语言并明确说明。
 * 绝不假装评了无法评估的维度。
 */
export async function reviewTranslation({ source, translation, level, onDelta }) {
  const hasSource = !!source && source.trim().length > 10;
  const lv = level === 'CET6' ? 'CET6' : 'CET4';
  const lvLabel = LEVEL_LABEL[lv];

  const system =
    `你是一位大学英语${lvLabel}翻译阅卷教师，严格按官方标准评分。` +
    '你的回答必须是一个完整的 JSON 对象，不要包含任何解释文字，不要用 markdown 代码块包裹。' +
    '第一个字符必须是 {，最后一个字符必须是 }。';

  // 翻译的判定依据是译文质量，与作文的字数规则不同 ——
  // 四六级翻译没有「译文必须多少词」的要求，因此不按字数降档。
  const qualityBlock = `
【翻译评分维度（按 ${lvLabel} 标准，重点看译文质量而非字数）】
1. 语义准确 —— 有无错译、漏译、误译；是否传达了原文的核心意思
2. 要点完整 —— 原文中并列的要点（列举项、转折、分项说明）是否都译出
3. 语法正确 —— 时态、语态、主谓一致、从句结构是否正确
4. 中式直译规避 —— 是否照搬汉语语序（如"我认为...""应该被.."），
   该用被动却用主动、长定语堆叠、不合英文习惯的动词搭配
5. 表达效果 —— 用词是否地道、句式是否自然多变、整体是否通顺可读

按官方评分标准扣分：主要错译漏译每处扣分严重，次要错译漏译每处扣 0.5 分，
现词错误、词序错误、标点错误各扣 0.5 分；译文通顺、表达清晰加分。`;

  const sourceBlock = hasSource
    ? `
【汉译英原文】
"""
${source}
"""
${qualityBlock}`
    : `
【重要：学生未提供原文】
这很常见——学生只是把自己写好的英译文拿过来求批改。
你**无法评估译文准度**，因此：
- 分数只针对**译文本身的语言质量**（用词、语法、搭配、表达流畅度）
- 必须在 accuracy 字段里明确写「未提供原文，未评估准度」，
  绝不能假装评了准度，也不要因此给低分
- 请把重心放在语法错误、词汇搭配、中式表达上
${qualityBlock}`;

  const prompt =
    `
【大学英语四六级翻译评分标准 · 满分15分】
` +
    sourceBlock +
    `

【学生译文】
"""
${translation}
"""

请严格按以下 JSON 结构输出：
{
  "score": 总分数字(0-15的整数，可含0.5),
  "hasSource": ${hasSource ? 'true' : 'false'},
  "accuracy": "准度点评（未提供原文时写明未评估准度）",
  "fluency": "通顺度点评",
  "chineseExpressions": ["中式英语表达"],
  "grammarErrors": [{"original": "你写的片段", "corrected": "参考改法", "type": "错译/漏译/词汇/词序/标点", "explain": "原因"}],
  "nextStep": "下一步最该改进的一件事"
}`;

  return parseJSON(await askModel({ system, prompt, temperature: 0.4, onDelta }));
}

/** 详细翻译批改：按需补齐整段升级译文（放在快速批改之外，避免拖慢首屏） */
export async function reviewTranslationDetail({ source, translation }) {
  const system =
    '你是大学英语四六级翻译阅卷教师。只输出JSON，第一个字符必须是{，最后一个字符必须是}。';
  const sourceBlock = source && source.trim() ? `【汉译英原文】\n${source}` : '（学生未提供原文，仅润色译文）';

  const prompt = `${sourceBlock}

【学生译文】
${translation}

输出 JSON：
{
  "upgrade": "整段升级版参考译文",
  "errors": [{"original": "你写的片段", "corrected": "参考改法", "type": "类型", "explain": "原因，最多5条"}]
}`;

  const r = parseJSON(await askModel({ system, prompt, temperature: 0.4 }));
  return { upgrade: r.upgrade || '', errors: r.errors || [] };
}

// ===== 容错解析：推理模型常在 JSON 前后附带说明文字 =====
export function parseJSON(raw) {
  if (!raw) throw new Error('empty_response');
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const start = text.indexOf('{');
  if (start === -1) throw new Error('invalid_json');

  // 括号配平，避免 JSON 字符串值里的 } 提前截断
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('invalid_json');

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error('invalid_json');
  }
}

// ===== 错误翻译 =====
export function explainError(e) {
  const msg = String(e?.message || e || '');
  if (msg.includes('sdk_not_loaded')) return '网络组件加载失败，请检查网络后刷新';
  if (msg.includes('no_model_available')) return '暂无可用模型，请稍后重试';
  if (msg.includes('empty_response')) return '模型未返回内容，请重试';
  if (msg.includes('invalid_json')) return '解析结果失败，请重试';
  if (/auth_/.test(msg)) return '身份验证失败，请刷新页面重试';
  if (/quota_/.test(msg)) return '调用额度不足，请稍后再试';
  if (/gateway_/.test(msg) || /model_/.test(msg)) return '服务暂时不可用，请重试';
  if (/timeout|network|Failed to fetch/i.test(msg)) return '网络异常，请检查网络';
  return '出错了，请重试';
}

// ===== 图片转录（拍纸作文）=====
/**
 * 把草稿纸照片转录成文本。
 *
 * 真实场景：绝大多数同学写在草稿纸/试卷/笔记本上，不会手打。
 * 因此这是核心入口，不是附加功能。
 *
 * 关键设计：**宁可标注不确定，也不要瞎猜**。
 * 手写体 + 划改 + 涂改的组合下，模型必然会拿不准某些词；
 * 猜错会让批改基于错误文本给出错误建议，比不给更糟。
 * 所以要求模型把拿不准的词用 [?] 标出，用户在输入框里改一下即可。
 *
 * @param {string} base64data 带 data:image/xxx;base64, 前缀的图片数据
 * @returns {Promise<{text: string, uncertain: number}>}
 */
export async function transcribeImage(base64data, onDelta) {
  const cloud = getCloud();
  const model = await getModel(cloud);

  const system =
    '你是英语作文转录助手。用户给你一张写在纸上的英语作文照片（可能有横线、划改、涂改）。\n' +
    '转录规则：\n' +
    '1. 保持原文的段落结构与拼写，**不要纠错、不要润色**，纠错交给后续批改环节\n' +
    '2. 印刷体与手写体都要能识别\n' +
    '3. 被划掉但仍能辨认的内容要转录出来\n' +
    '4. 完全涂黑/涂抹导致无法辨认的词，用 [?] 标记\n' +
    '5. **凡是你没有把握的词（尤其是手写潦草的字），一律用 [?] 标记，绝不要猜**\n' +
    '   例如：looks like "manage" 但不确定 → 写成 [?]manage[?]\n' +
    '6. 横线、装订线、污渍等干扰直接忽略\n' +
    '7. 如果整张图都没有英文，输出空字符串\n\n' +
    '只输出转录结果本身，不要解释、不要标题、不要 markdown 代码块。';

  let answer = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: model.id,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请转录这张图片里的英文作文。拿不准的词用 [?] 标记。',
          },
          { type: 'image_url', image_url: { url: base64data } },
        ],
      },
    ],
    stream: true,
    temperature: 0.1,
    reasoning_effort: 'none',
  })) {
    const d = chunk.choices[0]?.delta?.content;
    if (d) {
      answer += d;
      if (onDelta) onDelta(d, answer);
    }
  }

  const text = cleanTranscribed(answer);
  // 统计不确定标记的数量，让 UI 提示用户核对
  const uncertain = (text.match(/\[\?\]/g) || []).length;
  if (!text || text.replace(/\[\?\]/g, '').trim().length < 10) throw new Error('ocr_empty');
  return { text, uncertain };
}

/**
 * 一次拍照，分别识别原文与译文。
 *
 * 用户实测反馈：拍整页后全被塞进「原文」框，译文框还是空的，
 * 还得手动复制过去。
 *
 * 真实场景：一张卷子上中文原文在上、英文译文在下，
 * 一次拍照就应该分别落到两个框里。
 *
 * @returns {Promise<{source: string, translation: string, uncertain: number}>}
 */
export async function transcribeTranslationSheet(base64data) {
  const cloud = getCloud();
  const model = await getModel(cloud);

  const system =
    '你是英语翻译批改助手。用户给你一张试卷或草稿纸的照片，上面通常同时包含：\n' +
    '【中文原文】（汉译英的题目）和【学生的英译译文】。\n\n' +
    '识别规则：\n' +
    '1. 先判断哪部分是中文、哪部分是英文，按位置分别输出\n' +
    '2. 保持原始拼写与语法错误，不要纠错（纠错是批改环节的事）\n' +
    '3. 划掉但仍能辨认的内容要转录；涂抹或模糊到无法辨认的词用 [?] 标记\n' +
    '4. 凡是没有把握的词一律用 [?] 标记，绝不要猜\n' +
    '5. 不要输出 markdown 标记、波浪号、星号\n' +
    '6. 只有中文没有英文时 translation 为空字符串；只有英文没有中文时 source 为空字符串\n\n' +
    '只输出 JSON，第一个字符必须是 {，最后一个字符必须是 }。';

  let answer = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: model.id,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请分别识别这张图里的中文原文和英文译文。' },
          { type: 'image_url', image_url: { url: base64data } },
        ],
      },
    ],
    stream: true,
    temperature: 0.1,
    reasoning_effort: 'none',
  })) {
    const d = chunk.choices[0]?.delta?.content;
    if (d) answer += d;
  }

  const parsed = parseJSON(answer);
  const source = stripMarks(parsed.source || '');
  const translation = stripMarks(parsed.translation || '');
  const uncertain =
    ((parsed.source || '').match(/\[\?\]/g) || []).length +
    ((parsed.translation || '').match(/\[\?\]/g) || []).length;

  if (!source && !translation) throw new Error('ocr_empty');
  return { source, translation, uncertain };
}

/** 清除波浪线/星号等噪声标记，统一为 [?] */
function stripMarks(text) {
  return String(text || '')
    .replace(/~{1,4}([^~\n]{0,40}?)~{1,4}/g, '[?]$1[?]')
    .replace(/~+/g, '[?]')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .trim();
}

/**
 * 清理转录结果。
 *
 * 用户实测反馈：识别结果里出现大量 `~` 符号（如 "this ~~global~~ goal"）。
 * 原因：模型在图片模糊/装订线干扰处用 ~~ 或 ~ 标记"这里不确定"，
 * 但它没按我要求的 [?] 格式输出，于是这些标记混进了正文。
 *
 * 清洗策略：
 *  1. 把常见的波浪线标记统一转成 [?]（保留不确定性信息）
 *  2. 清理 Markdown 加粗残留
 *  3. 合并多余空白
 */
function cleanTranscribed(raw) {
  let t = String(raw || '').trim();

  // 去掉 markdown 代码块
  t = t.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '');

  // 去掉模型可能加的引言
  t = t.replace(/^(以下是|转录如下|识别结果|Here's|Here is)[^\n:：]*[:：]\s*/i, '');

  // ★ 波浪线标记统一为 [?]，这是用户明确反馈的问题
  t = t.replace(/~{1,4}([^~\n]{0,40}?)~{1,4}/g, '[?]$1[?]');  // ~~word~~ → [?]word[?]
  t = t.replace(/~+/g, '[?]');                                // 残留的单个 ~

  // 去掉 markdown 加粗/斜体残留
  t = t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/(?<!\w)\*(.*?)\*(?!\w)/g, '$1');

  return t.trim();
}

// 延迟取cloud，避免循环依赖
export { WRITING_RUBRIC, SPEAKING_RUBRIC };