# v0.1.0-preview.3 验收记录

Windows 11 x64，Electron 45.3.3，外置 FFmpeg 和 FFprobe 9.0.2。

| 检查 | 结果 |
| --- | --- |
| 启动、导航与布局 | 启动后进入起始页，FFmpeg 状态在封面工具内显示。检查侧栏分组和底部入口、连续切页、760 px 窄窗和抽屉 |
| 动效 | 实测切页淡入与侧栏滑动，验证首页柔光、按钮扫光和涟漪、拖入光效与取消、封面替换、日志错峰、进度状态和成功勾选 |
| 减少动效 | 用 Windows 动效偏好和应用设置分别验证，切页、拖入和对话框仍能正常操作 |
| 关于 | 作者文字与源文档一致。阻断 HTTP/HTTPS 后头像、社交图标和收款码仍可加载，收款码可放大。检查更新显示待接入提示 |
| 素材与导出 | 用原生文件选择、两文件拖入和单件替换导入素材，测试隔离副本移走后的错误反馈，确认导出过程中切页再返回可见成品结果 |
| 成片核对 | 逐轨视频和音频 SHA-256 与原片一致，内嵌 PNG 与原封面 SHA-256 一致。时长为 41.621333 秒，时间码为 00:02:16:35。Windows 原生文件选择器中，导出文件的缩略图显示内嵌封面。用 Windows Shell 缩略图接口复核了最后保留的成片 |
| 构建与清理 | 类型检查、生产构建、Windows x64 便携打包和解压运行通过。测试目录位于系统临时路径，项目里只保留一份验收成片 |

## 复查成片

对原视频和验收视频各执行一次逐流哈希检查。对提取的图片使用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 比较原封面。

```powershell
ffmpeg -v error -i input.mp4 -map "0:V" -map "0:a?" -c copy -f streamhash -hash SHA256 -
ffprobe -v error -show_streams -show_chapters -of json output.mp4
ffmpeg -v error -i output.mp4 -map "0:v:disp:attached_pic" -c copy -frames:v 1 -update 1 extracted.png
```

其他 Windows 环境可在资源管理器的大图标视图中复查。社交地址按用户提供的链接配置。
