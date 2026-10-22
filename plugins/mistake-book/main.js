// 错题本（第一方插件）：本地保存、列表、清空。
module.exports.register = (host) => {
  host.chat.command('wrong-add', async (args) => {
    const text = String(args || '').trim();
    if (!text) throw new Error('请在 /wrong-add 后面写题目或错因');
    await host.mistakes.add(text, []);
    const items = await host.mistakes.list();
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
    const it = items[Math.floor(Math.random() * items.length)];
    const issues = (it.issues || []).length ? '\n上次的问题：' + it.issues.join('；') : '';
    return { text: `来，重做这道题：

${it.text}${issues}

做完后再用 /wrong-add 记录新的错因。` };
  }, '随机抽一道错题复习');

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
