// 讲解工坊（第一方插件）：交互讲解页 + 讲解视频。
module.exports.register = (host) => {
  host.chat.command('explain', async (args) => {
    const topic = String(args || '').trim();
    if (!topic) throw new Error('请在 /explain 后面写知识点或题目');
    const r = await host.teach.explain(topic);
    return { text: `讲解页做好啦，已经在独立窗口打开：${topic}`, openPath: r.path };
  }, '生成交互讲解页，例如 /explain 勾股定理');

  host.chat.command('video', async (args) => {
    const topic = String(args || '').trim();
    if (!topic) throw new Error('请在 /video 后面写知识点');
    const r = await host.video.make(topic);
    return { text: `视频做好啦：${r.title}\n\n文件：${r.video}\n\n约 ${(r.duration / 60).toFixed(1)} 分钟` };
  }, '生成讲解视频（需要几分钟），例如 /video 勾股定理');
};
