# v0.1.0-preview.4 验收记录

Windows 11 x64，Electron 45.3.3，外置 FFmpeg 和 FFprobe 9.0.2。

| 检查 | 结果 |
| --- | --- |
| 切页 | 逐帧检查入场的 40 ms 延时、上方 7 px 起步和 3 px 模糊，确认旧页在淡出期间可见且已退出交互。连续快切时最多保留一个离场层 |
| 悬浮侧栏 | 检查窄栏悬停展开、离开收回、提前返回取消收回、边缘扫光、主内容位置固定、顶部按钮与 `Ctrl+B` 固定侧栏，以及 750 px 窄窗抽屉 |
| 深浅主题 | 旧设置默认深色，检查即时切换、重启记忆、Windows 原生标题栏和浅色收款码弹层 |
| 减少动效 | 本机 Windows 启用了减少动效。分别检查系统偏好和应用开关，并在隔离测试窗口内模拟 Windows 开启动画采样正常切页 |
| 素材与导出 | 拖入两份测试素材，确认封装期间切页、返回查看结果和切换主题后素材与成品入口仍在 |
| 成片核对 | 逐轨视频和音频 SHA-256 与原片一致，内嵌 PNG 与原封面 SHA-256 一致。时长为 41.621333 秒，时间码为 00:02:16:35 |
| 构建与清理 | 类型检查、生产构建、Windows x64 便携打包与解压运行通过。测试目录位于系统临时路径，项目里保留一份验收成片 |

## 复查成片

对原视频和验收视频各执行一次逐流哈希检查。对提取的图片使用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 比较原封面。

```powershell
ffmpeg -v error -i input.mp4 -map "0:V" -map "0:a?" -c copy -f streamhash -hash SHA256 -
ffprobe -v error -show_streams -show_chapters -of json output.mp4
ffmpeg -v error -i output.mp4 -map "0:v:disp:attached_pic" -c copy -frames:v 1 -update 1 extracted.png
```

其他 Windows 环境可在资源管理器的大图标视图中复查。社交地址按用户提供的链接配置。
