// 示例插件：演示命令注册、桌宠说话、模板面板。
module.exports.register = (host) => {
  host.chat.command('hello', async () => {
    host.pet.say('插件说：你好呀！');
    return {
      text: '你好！我是「示例插件」注册的 /hello 命令。',
      panel: host.ui.panel('steps', {
        title: '示例插件能做什么',
        steps: [
          { title: '注册命令', body: '插件可以注册自己的 /命令，在聊天框里直接调用。' },
          { title: '让奶龙说话', body: '通过 host.pet.say 让桌宠冒一个气泡。' },
          { title: '弹面板', body: '通过 host.ui.panel 渲染 list / form / steps 三种模板。' },
        ],
      }),
    };
  }, '打招呼，演示插件能力');

  host.chat.command('hello-help', async () => ({
    text: '可用命令：/hello（演示面板）、/hello-help（这条说明）。',
  }), '查看示例插件的命令');
};
