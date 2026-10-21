// 学习资料助手（第一方插件）：画像 + 知识库检索 + 学习路径。
module.exports.register = (host) => {
  host.chat.command('study', async (args) => {
    const q = String(args || '').trim();
    if (!q) throw new Error('请在 /study 后面写课程或问题');
    const profile = await host.kb.profile();
    const refs = (await host.kb.search(q)) || [];
    const refText = refs.slice(0, 5).map((r, i) => `[${i + 1}] ${r.source}\n${r.text}`).join('\n\n');
    const prompt = `你是学习规划助手。用户画像：${JSON.stringify(profile)}\n\n问题：${q}\n\n参考资料：\n${refText || '（暂无本地资料）'}\n\n请按以下结构输出：结论 / 前置知识 / 分阶段计划（表格）/ 资料清单 / 学长学姐经验（只引用经验类资料）/ 检验方式 / 接下来 7 天。引用资料用 [n]；不要编造校内资料。`;
    const r = await host.ai.ask(prompt);
    return { text: (r && r.text) || '没有生成内容' };
  }, '生成学习路径，例如 /study 人工智能数学方法怎么学');

  host.chat.command('kb-stats', async () => {
    const list = (await host.kb.list()) || [];
    const items = list.map((d) => ({ title: d.name, subtitle: `${d.chunks || 0} 段 · ${d.source || ''}` }));
    return {
      text: `知识库共 ${items.length} 份资料`,
      panel: host.ui.panel('list', { title: '我的资料', items }),
    };
  }, '查看知识库里的资料');
};
