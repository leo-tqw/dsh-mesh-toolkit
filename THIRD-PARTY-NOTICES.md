# 第三方说明

本包**不包含**任何第三方代码。它做两件事：

1. 声明对以下两个 MIT 插件的依赖（由 npm / pnpm 从它们自己的仓库安装）：

   | 包 | 上游 | 许可证 |
   |---|---|---|
   | `dsh-device-mesh` | https://github.com/kfxhjz/dsh-device-mesh | MIT, © dsh-device-mesh contributors |
   | `dsh-peer-sync` | https://github.com/yc5991/dsh-peer-sync | MIT, © yc5991 |

2. `patches/` 里的脚本会在你**主动运行**时修改这两个包已安装的文件（MIT 允许修改，
   条件是保留版权声明——它们自己的 `LICENSE` 文件始终留在原处，本包不复制、不替换）。
   每个补丁都幂等、带 `.orig` 备份、语法校验通过才写入，并附明确说明：

   - `patch-peer-sync-utf8-name.mjs` — 修复机器名含非 ASCII 字符时 `x-peer-name` 头非法、
     导致所有出站请求失败的缺陷
   - `patch-peer-sync-host.mjs` — 等回合结束才返回，避免把开场白当答案
   - `patch-peer-sync-client.mjs` — 标明投递目标会话、本机行去掉跨机按钮、等待预算加长
   - `patch-peer-sync-sidebar.mjs` — 跨机同步放进左侧边栏
   - `patch-peer-sync-shell.mjs` — 独立页面的留白与层级
   - `patch-peer-sync-workdir.mjs` — 远程会话默认工作目录
   - `patch-device-mesh-ui.mjs` — 在线徽标改为圆点；点本机会话时收起远程面板

如果你只想用未经修改的上游版本，不运行 `patches/` 即可，四个工具与技能照常工作。
