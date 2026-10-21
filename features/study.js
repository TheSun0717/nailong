// 学习助手：意图判断 + 画像 + 查询扩展 + 知识库检索 → 结构化学习路径提示词
const kb = require('./kb');

const STUDY_RE = /怎么学|如何学|学习路径|学习路线|复习计划|复习|备考|期末|期中|考研|保研|先修|这门课|课程|教材|参考书|刷题|入门|知识点|考试|作业|讲义|试卷|学习方法/;

// 课程别名/关联概念：只用于扩展检索，不写进给用户的回答
const ALIASES = [
  { re: /人工智能数学方法|智能科学数学基础|AI\s*数学|数学基础/i, add: '矩阵 线性代数 概率 优化 梯度 机器学习 数学基础' },
  { re: /机器学习|模式识别/, add: '监督学习 模型 损失函数 过拟合 评估 吴恩达 西瓜书' },
  { re: /深度学习|神经网络/, add: '反向传播 优化器 CNN Transformer 训练 调参' },
  { re: /线性代数/, add: '矩阵 向量空间 特征值 奇异值分解 投影' },
  { re: /概率论|概率统计/, add: '随机变量 分布 期望 方差 最大似然 贝叶斯' },
  { re: /高等数学|微积分/, add: '极限 导数 积分 级数 期末' },
  { re: /数据结构|算法/, add: '链表 树 图 排序 动态规划 复杂度' },
  { re: /操作系统/, add: '进程 线程 内存 调度 文件系统 闭卷' },
  { re: /计算机网络/, add: 'TCP IP 协议 分层 拥塞控制' },
  { re: /数据库/, add: 'SQL 范式 事务 索引 PPT 例题' },
];

const KIND_LABEL = { experience: '经验', method: '方法', syllabus: '大纲', notes: '资料' };

function shouldUse(question) {
  return STUDY_RE.test(String(question || ''));
}

function expandQuery(question) {
  const extra = ALIASES.filter((a) => a.re.test(String(question || ''))).map((a) => a.add);
  return extra.length ? `${question} ${extra.join(' ')}` : String(question || '');
}

function profileText(p = {}) {
  const parts = [];
  if (p.level) parts.push(`学段：${p.level}`);
  if (p.region) parts.push(`地区：${p.region}`);
  if (p.school) parts.push(`学校：${p.school}`);
  if (p.major) parts.push(`专业：${p.major}`);
  if (p.grade) parts.push(`年级：${p.grade}`);
  return parts.length ? parts.join('；') : '（用户还没填写画像）';
}

function buildStudyContext(question, config = {}) {
  const p = config.profile || {};
  let refs = [];
  try {
    refs = kb.search(expandQuery(question), { school: p.school, level: p.level, limit: 6 });
  } catch { refs = []; }

  const refBlock = refs.length
    ? refs.map((r, i) => `[${i + 1}] 类型：${KIND_LABEL[r.kind] || '资料'}；来源：${r.source}${r.school ? `（${r.school}）` : ''}\n${r.text}`).join('\n\n')
    : '（知识库里暂时没有相关资料）';

  const system = `你是「奶龙」的学习规划模式：一只认真起来很靠谱的小奶龙。现在要帮用户规划一门课/一个知识点的学习与复习。

用户画像：${profileText(p)}

用户的问题：${question}

可引用的本地资料（类型标注了「经验/方法/大纲/资料」；同校资料已优先检索）：
${refBlock}

输出结构（必须按这个顺序，用 Markdown）：
## 结论
一句话说清难点、学完应该会什么，以及这份计划适合投入多少时间。
## 前置知识
缺什么补什么，按「必须补 / 可以边学边补」分组。
## 分阶段计划
用表格：阶段 | 时间 | 目标 | 具体做什么 | 产出。默认 4–8 周，每周给出可执行任务，不要只写「复习第 X 章」。
## 资料清单
分三组列出：
1. 你上传的资料（用 [n] 标注）
2. 公开经验/课程（用 [n] 标注类型为「经验」的条目；没引用就写「暂无」）
3. 通用建议（教材/公开课/题型，不声称来自某校）
## 学长学姐经验（优先级最高）
同校、同专业学长学姐的经验优先级最高：先引用同校经验，再引用公开经验；只引用类型为「经验」的 [n]，摘录 2–4 条能直接执行的做法，并注明来源名称；如果资料里没有经验类内容，写「暂无同校学长学姐经验，以下为通用方法」。
## 怎么检验学会了
给可执行的自测方式（闭卷默写/限时题/讲给别人听）。
## 接下来 7 天
列出第 1 到第 7 天每天做什么，每天控制在 1–3 小时。

规则：
- 引用格式 [1][2]；只有引用过的内容才可以说来自资料。
- 同校经验优先；公开经验要和通用建议区分开。
- 不编造具体校内试卷、学长原话或课程给分。
- 如果用户画像缺失，开头先请他补充学段/学校/专业，然后给出通用版计划。
- 中文；保持奶龙口吻，但内容优先，不要过度卖萌。`;

  return { system, refs };
}

module.exports = { shouldUse, buildStudyContext, profileText, expandQuery };
