/** 四六级写作题库与翻译题库 */
const ESSAY_TASKS = [
  {
    id: 'e1',
    type: '议论文',
    level: 'CET4',
    title: 'The Importance of Time Management for College Students',
    prompt:
      '有人认为时间管理对大学生并不重要，因为年轻人有足够的时间可以挥霍；也有人认为这是误解，时间管理是大学生成功的关键。请写一篇短文，说明你的观点并给出理由。',
    wordLimit: '120-180 词',
    outline: [
      '第一段：引出争议 —— 大学生活看似宽松，实则课业、社团、竞赛并行',
      '第二段：论证时间管理的价值 —— 专注力、复盘效率、减少焦虑',
      '第三段：如何做 —— 番茄钟、优先级排序、拒绝无效社交',
    ],
  },
  {
    id: 'e2',
    type: '议论文',
    level: 'CET4',
    title: 'Should College Students Take Part-time Jobs?',
    prompt:
      '越来越多大学生在课余时间做兼职赚取生活费。有人认为这有助于提前接触社会，也有人认为这会耽误学业。请写一篇短文讨论这一现象，并给出你的建议。',
    wordLimit: '120-180 词',
    outline: [
      '第一段：现象描述 —— 兼职已成为校园常态',
      '第二段：正方价值 —— 经济独立、职场认知、时间管理倒逼',
      '第三段：风险与平衡 —— 警惕过度投入，用每周时长设上限',
    ],
  },
  {
    id: 'e3',
    type: '现象类',
    level: 'CET4',
    title: 'The Rise of Short-video Platforms',
    prompt:
      '近年来短视频平台迅速普及，吸引了大量年轻人。请写一篇短文，分析这一现象的原因，并讨论它带来的影响。',
    wordLimit: '120-180 词',
    outline: [
      '第一段：现象与规模',
      '第二段：背后原因 —— 算法推荐、低门槛、移动端普及',
      '第三段：影响 —— 知识获取便利 vs 信息茧房与注意力碎片化',
    ],
  },
  {
    id: 'e4',
    type: '图表类',
    level: 'CET6',
    title: 'The Changing Proportion of Online vs Offline Shopping',
    prompt:
      '下面图表反映了 2019-2024 年中国居民网上购物与实体店购物的比例变化。请写一篇短文，分析图表反映的问题并给出你的建议。',
    wordLimit: '150-200 词',
    outline: [
      '第一段：描述图表 —— 线上占比逐年上升，线下持续下滑',
      '第二段：分析原因 —— 物流效率、直播带货、年轻消费习惯',
      '第三段：建议 —— 实体店应转型体验型消费，而非与线上比价',
    ],
  },
  {
    id: 'e5',
    type: '观点类',
    level: 'CET6',
    title: 'Artificial Intelligence and the Future of Employment',
    prompt:
      '人工智能正在改变工作方式。有人担心AI会取代大量岗位，也有人认为它只会创造新的工作类型。请写一篇短文，提出你的看法并论证。',
    wordLimit: '150-200 词',
    outline: [
      '第一段：引出AI与就业的讨论',
      '第二段：替代效应 —— 重复性任务首当其冲',
      '第三段：辩证分析 —— 创造效应、需要培养的核心能力',
    ],
  },
];

const TRANSLATION_TASKS = [
  {
    id: 't1',
    level: 'CET4',
    direction: '汉译英',
    title: '传统节日',
    source:
      '春节是中国最重要的传统节日。每年农历新年，家家户户都会团聚在一起，吃年夜饭，走亲访友，燃放鞭炮，庆祝新年的到来。',
    reference:
      'The Spring Festival is the most important traditional festival in China. Every year on the first day of the lunar new year, family members gather together to have a reunion dinner, visit relatives and friends, set off firecrackers and celebrate the arrival of the new year.',
    keyPoints: ['Spring Festival', 'lunar new year', 'reunion dinner', 'visit relatives and friends', 'set off firecrackers'],
  },
  {
    id: 't2',
    level: 'CET4',
    direction: '汉译英',
    title: '终身学习',
    source:
      '随着社会的快速发展，终身学习变得越来越重要。人们需要不断更新自己的知识，以适应不断变化的职场环境。',
    reference:
      'With the rapid development of society, lifelong learning has become increasingly important. People need to constantly update their knowledge in order to adapt to the ever-changing workplace environment.',
    keyPoints: ['lifelong learning', 'rapid development', 'constantly update', 'adapt to', 'workplace environment'],
  },
  {
    id: 't3',
    level: 'CET6',
    direction: '汉译英',
    title: '文化遗产保护',
    source:
      '文化遗产不仅是一个民族的宝贵财富，也是全人类的共同资产。保护文化遗产不仅需要政府的资金投入，更需要提高公众的参与意识。',
    reference:
      'Cultural heritage is not only a precious treasure of a nation but also a common asset of all humankind. Preserving cultural heritage requires not only financial investment from the government but also enhancing public awareness and participation.',
    keyPoints: ['cultural heritage', 'treasure', 'common asset', 'financial investment', 'public awareness'],
  },
];

const SPEAKING_TASKS = [
  {
    id: 's1',
    type: '个人陈述',
    level: 'CET4',
    topic: 'Describe your favorite way to relax after a busy day.',
    hint: '说清「做什么 + 为什么有效」，用 3-4 句话。时长 30 秒左右。',
  },
  {
    id: 's2',
    type: '个人陈述',
    level: 'CET4',
    topic: 'Talk about a skill you learned in college that was challenging.',
    hint: '描述难点 + 怎么突破 + 现在的收获。避免流水账。',
  },
  {
    id: 's3',
    type: '观点讨论',
    level: 'CET4',
    topic: 'Do you prefer studying alone or with a partner? Why?',
    hint: '给出明确立场，用「虽然…但是…」结构对比两种方式。',
  },
  {
    id: 's4',
    type: '观点讨论',
    level: 'CET6',
    topic: 'What are the advantages and disadvantages of remote work?',
    hint: '双刃剑结构：效率↑ vs 协作↓，最后给出你的判断。',
  },
  {
    id: 's5',
    type: '场景表达',
    level: 'CET6',
    topic: 'You are organizing a study group for an upcoming exam. Describe your plan.',
    hint: '时间、地点、分工、目标，用被动语态和条件句提升分数。',
  },
];

// 高分句式库
const PHRASES = [
  {
    cn: '随着……的快速发展',
    en: 'With the rapid development of...',
    note: '比 With the development of 层次更高，避免「随着……的发展」的低分表达',
  },
  {
    cn: '越来越多的人认为',
    en: 'An increasing number of people believe that...',
    note: '作文开篇最实用的过渡结构',
  },
  {
    cn: '在……方面发挥重要作用',
    en: 'play a crucial role in...',
    note: '比 is important 高级；crucial / vital / essential 可轮换',
  },
  {
    cn: '这不仅……而且……',
    en: 'Not only does it..., but it also...',
    note: '注意 Not only 置于句首时前两个词要倒装（does / do / is / are）',
  },
  {
    cn: '与……相比',
    en: 'By comparison with..., ...',
    note: '比 than 引导的比较句更书面',
  },
  {
    cn: '值得警惕的是',
    en: 'What deserves our attention is that...',
    note: '用于引出反面论证，显思辨性',
  },
  {
    cn: '归根结底',
    en: 'In the long run, ...',
    note: '结尾段收束的利器',
  },
  {
    cn: '这是一个双刃剑',
    en: 'It is a double-edged sword that...',
    note: '议论文分析利弊的标准句式',
  },
];

export { ESSAY_TASKS, TRANSLATION_TASKS, SPEAKING_TASKS, PHRASES };