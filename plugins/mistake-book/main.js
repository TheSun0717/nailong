// 错题本（第一方插件）：本地保存、列表、清空。
module.exports.register = (host) => {
  const DAY = 24 * 3600 * 1000;
  const INTERVALS = [1, 3, 7, 15];
  const metaMap = () => host.settings.get('meta') || {};
  const saveMeta = (m) => host.settings.set('meta', m);
  host.chat.command('wrong-add', async (args) => {
    const text = String(args || '').trim();
    if (!text) throw new Error('请在 /wrong-add 后面写题目或错因');
    await host.mistakes.add(text, []);
    const items = await host.mistakes.list();
    if (items[0]) {
      const m = metaMap();
      m[items[0].id] = { stage: 0, due: Date.now() };
      saveMeta(m);
    }
    return { text: `已加入错题本（共 ${items.length} 条）` };
  }, '把题目或错因加入错题本');

  host.chat.command('wrong', async () => {
    const items = (await host.mistakes.list()) || [];
    const panel = host.ui.panel('list', {
      title: `错题本（${items.length}）`,
      items: items.slice(0, 20).map((it) => ({
        title: it.text.slice(0, 40),
        subtitle: new Date(it.ts).toLocaleString('zh-CN'),
      })),
    });
    return {
      text: items.length ? `错题本共 ${items.length} 条` : '错题本是空的，用 /wrong-add 加一条',
      panel: items.length ? panel : undefined,
    };
  }, '查看错题本');

  host.chat.command('wrong-review', async () => {
    const items = (await host.mistakes.list()) || [];
    if (!items.length) return { text: '错题本是空的，用 /wrong-add 加一条' };
    const meta = metaMap();
    const due = items.filter((x) => !meta[x.id] || (meta[x.id].due || 0) <= Date.now());
    const pool = due.length ? due : items;
    const it = pool[Math.floor(Math.random() * pool.length)];
    const m = metaMap();
    const cur = m[it.id] || { stage: 0 };
    const stage = Math.min((cur.stage || 0) + 1, INTERVALS.length - 1);
    m[it.id] = { stage, due: Date.now() + INTERVALS[stage - 1] * DAY };
    saveMeta(m);
    const issues = (it.issues || []).length ? '\n上次的问题：' + it.issues.join('；') : '';
    const next = new Date(m[it.id].due).toLocaleDateString('zh-CN');
    return { text: `来，重做这道题：\n\n${it.text}${issues}\n\n下次复习：${next}（做完用 /wrong-add 记录新错因）` };
  }, '随机抽一道错题复习');

  // 把到期错题剪成复习短片：一题一镜，看完自动顺延复习计划（不调模型，只配音 + 渲染）
  host.chat.command('wrong-video', async () => {
    const items = (await host.mistakes.list()) || [];
    if (!items.length) throw new Error('错题本是空的，用 /wrong-add 加一条再试');
    const meta = metaMap();
    const due = items.filter((x) => !meta[x.id] || (meta[x.id].due || 0) <= Date.now());
    const pool = (due.length ? due : items).slice(0, 3);
    const steps = pool.map((it, i) => ({
      title: `错题 ${i + 1}`,
      body: (it.issues || []).length
        ? '上次的问题是：' + it.issues.slice(0, 2).join('；')
        : '先自己做一遍，想不起来再看提示。',
      visual: { type: 'spotlight', data: { title: '先自己做', text: String(it.text).slice(0, 44) } },
    }));
    steps.push({
      title: '明天见',
      body: '按第一天、第三天、第七天、第十五天复习，忘了就再来一遍。',
      visual: { type: 'spotlight', data: { title: '复习节奏', text: '1 / 3 / 7 / 15 天' }, camera: { from: 1, to: 1.05 } },
    });
    const r = await host.video.makeSpec({
      title: `错题复习 · ${pool.length} 道`,
      subject: '错题本 · 间隔复习',
      intuition: '先自己做一遍，再对答案；想不起来就看提示。',
      analogy: '就像把路重新走一遍，走多了就熟了。',
      steps,
    });
    const m = metaMap();
    pool.forEach((it) => {
      const cur = m[it.id] || { stage: 0 };
      const stage = Math.min((cur.stage || 0) + 1, INTERVALS.length - 1);
      m[it.id] = { stage, due: Date.now() + INTERVALS[stage - 1] * DAY };
    });
    saveMeta(m);
    return {
      text: `复习短片做好啦：${r.title}\n\n${r.video}\n\n约 ${Math.round(r.duration)} 秒 · ${pool.length} 道错题已顺延到下次复习`,
    };
  }, '把到期的错题剪成复习短片');

  host.chat.command('wrong-due', async () => {
    const items = (await host.mistakes.list()) || [];
    const meta = metaMap();
    const due = items.filter((x) => !meta[x.id] || (meta[x.id].due || 0) <= Date.now());
    const panel = host.ui.panel('list', {
      title: `待复习（${due.length}）`,
      items: due.slice(0, 20).map((x) => ({ title: x.text.slice(0, 40), subtitle: '今天到期' })),
    });
    return { text: due.length ? `今天有 ${due.length} 道错题到期` : '今天没有到期的错题', panel: due.length ? panel : undefined };
  }, '查看今天到期的错题');

  host.chat.command('wrong-stats', async () => {
    const items = (await host.mistakes.list()) || [];
    const issueCount = {};
    items.forEach((it) => (it.issues || []).forEach((x) => { issueCount[x] = (issueCount[x] || 0) + 1; }));
    const top = Object.entries(issueCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const panel = host.ui.panel('list', {
      title: `错题统计（${items.length}）`,
      items: top.map(([k, v]) => ({ title: k, subtitle: `${v} 次` })),
    });
    return { text: `错题本共 ${items.length} 条` + (top.length ? '，高频错因见面板' : ''), panel };
  }, '按错因统计错题');

  host.chat.command('wrong-remove', async (args) => {
    const n = parseInt(String(args || '').trim(), 10);
    const items = (await host.mistakes.list()) || [];
    if (!Number.isFinite(n) || n < 1 || n > items.length) throw new Error('用法：/wrong-remove 序号（先 /wrong 查看）');
    const removed = items.splice(n - 1, 1)[0];
    await host.mistakes.clear();
    for (const it of items.reverse()) await host.mistakes.add(it.text, it.issues || []);
    return { text: `已移除：${removed.text.slice(0, 30)}` };
  }, '按序号移除错题');

  host.chat.command('wrong-clear', async () => {
    await host.mistakes.clear();
    return { text: '错题本已清空' };
  }, '清空错题本');
};
