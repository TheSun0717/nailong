// 讲解工坊（第一方插件）：交互讲解页 + 讲解视频。
module.exports.register = (host) => {
  host.chat.command('explain', async (args) => {
    const topic = String(args || '').trim();
    if (!topic) throw new Error('请在 /explain 后面写知识点或题目');
    const r = await host.teach.explain(topic);
    return { text: `讲解页做好啦，已经在独立窗口打开：${topic.slice(0, 32)}${topic.length > 32 ? '…' : ''}`, openPath: r.path };
  }, '生成交互讲解页，例如 /explain 勾股定理', ['讲解页', '做成讲解页', '详细讲解', '一步步讲', '讲讲这道', '讲一下这道', '讲解一下', '讲解这道', '详细讲讲', '解析一下这道']);

  host.chat.command('video', async (args) => {
    const topic = String(args || '').trim();
    if (!topic) throw new Error('请在 /video 后面写知识点');
    const r = await host.video.make(topic);
    return { text: `视频做好啦：${r.title}\n\n文件：${r.video}\n\n约 ${(r.duration / 60).toFixed(1)} 分钟` };
  }, '生成讲解视频（需要几分钟），例如 /video 勾股定理', ['讲解视频', '视频讲解', '生成视频', '做个视频', '做成视频', '视频讲', '做一个视频']);
};
