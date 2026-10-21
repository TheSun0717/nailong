# 奶龙素材目录

已就位的素材（透明背景 PNG + H.264 视频）：

```
assets/
├── pet/
│   ├── idle.png         # 闲置：趴着（透明背景）
│   ├── stand.png        # 悬停：站起来看着你（透明背景）
│   ├── celebrate-1.mp4  # 9/23 双击：欢呼视频第一段（H.264 竖屏）
│   ├── celebrate-2.mp4  # 欢呼视频第二段（循环播放）
│   ├── blink.png        # 其他日期双击：眨眼图（透明背景）
│   ├── chat-top.png     # 对话框顶部趴着的奶龙（透明背景）
│   └── birthday.mp3     # 生日快乐歌（庆祝时循环播放）
├── avatar/
│   └── nailong.png      # 奶龙头像（透明背景，托盘图标也用它）
└── icon.ico             # 应用/安装包图标
```

注意事项：

- 图片必须用**透明背景 PNG**（黑底/白底已用连通域法去除）
- 视频必须是 **H.264** 编码（Electron 不支持 H.265/HEVC）；竖屏素材用「高度撑满、宽度自适应」展示
- 换素材时：图片抠图后存 PNG，视频转码 `ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p out.mp4`
