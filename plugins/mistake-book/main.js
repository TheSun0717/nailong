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

  host.chat.command('wrong-clear', async () => {
    await host.mistakes.clear();
    return { text: '错题本已清空' };
  }, '清空错题本');
};
