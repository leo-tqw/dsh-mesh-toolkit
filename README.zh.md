# dsh-mesh-toolkit · 双机互联运维工具包

两台 Mac 用 DSH 连起来之后，真正让人卡住的不是配对，是**配对之后**：到底通没通、怎么把文件送过去、出门还能不能用、坏了看哪里。

这个包把这几件事做成模型能直接调用的工具和一套技能。它**不包含** [dsh-device-mesh](https://github.com/kfxhjz/dsh-device-mesh) 与 [dsh-peer-sync](https://github.com/yc5991/dsh-peer-sync) 的代码——那两个插件是传输层，本包只是在它们之上补运维层。

## 四个工具

| 工具 | 用途 |
|---|---|
| `mesh_status` | 一次体检：本机标识、监听地址、每个对端可达性与最近同步、是否被撤销信任、device-mesh 双向配对、Tailscale 状态 |
| `mesh_setup` | 配置对齐 + 补丁重打。默认只读；`apply: true` 才写 peer-sync 配置（监听 0.0.0.0、允许远程投递、通告会话）并执行随包补丁 |
| `mesh_network` | 跨网可用性诊断：监听是否只绑了一个网卡、对端地址是内网还是 tailnet、配对凭据里有没有 tailnet 端点 |
| `mesh_send_file` | 单文件跨机传输：临时只读 HTTP（只暴露该文件）+ 对端通道 + 两端 sha256 比对 |

## 一个技能

`mesh-workflow`：执行地判断（谁在跑 → 文件在哪）、三条通道各自边界、产物落盘约定、派活标准流程、跨网络、故障对照表、权限与风险。

## 七个可选补丁

`patches/` 下的脚本在你主动运行时修改上面两个插件的已安装文件，修复它们自身的缺陷与体验问题，其中包括：

- **`patch-peer-sync-utf8-name`** —— 机器名含中文时 `x-peer-name` HTTP 头非法，导致**所有出站请求抛 ByteString 错**、界面显示「对端不可达」。这不是网络问题，是编码问题
- `patch-peer-sync-host` —— 等回合结束才返回，不把「我先确认一下」当成答案
- 其余五个：面板标注投递目标、侧栏入口、独立页面外观、远程会话默认目录、device-mesh 徽标与面板收起

全部幂等、带 `.orig` 备份、语法校验通过才写入。

## 安装

```bash
dsh plugin --profile desktop add github:<你的账号>/dsh-mesh-toolkit
```

依赖会一起装好。装完在新会话里应能看到上述四个工具与 `mesh-workflow` 技能。

## 为什么不用 AirDrop 传文件

Apple 官方要求 AirDrop 两台设备相距 **10 米以内**、接收方手动点接受，且 macOS 没有 AirDrop 命令行接口。跨城、无人值守都不成立。

本包的做法：本机起一个只暴露单个文件的临时 HTTP 服务（传完即关），让对方通过已有通道 `curl` 下来，最后比对两边 sha256。

## 权限说明

- 除 `mesh_send_file` 主动发起的那次传输外，四个工具只读本机状态
- `mesh_setup` 只有在 `apply: true` 时才写文件，写之前会报告将要改什么
- 补丁脚本需要你主动运行，不会自动执行

## 限制

- 单文件传输，目录请先打包
- 依赖 peer-sync 的对端通道；未安装时工具会明确提示
- 跨网络要求两侧监听地址可被对方访问（通常是把监听设为 `0.0.0.0`，并通过 tailnet 的 `100.x` 地址互访）

## License

MIT。第三方插件不在本包内，各自的许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
