# 可选本地补丁

这些不是本插件的功能，而是作者在自己两台机器上为了顺手而改的**别人插件**的源码。
它们改的是 `node_modules/dsh-peer-sync` 和 `node_modules/dsh-device-mesh` 里的文件，
**插件一升级就会被覆盖**。

每个脚本都是幂等的：打过了会跳过，替换点对不上会直接中止而不是乱改，并且第一次运行会留 `.orig` 备份。

```bash
RT="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies"
"$RT/node/bin/node" patches/patch-peer-sync-client.mjs
```

打完需要重启 DSH（客户端代码在页面加载时取用）。

| 脚本 | 改什么 |
|---|---|
| `patch-peer-sync-client.mjs` | 面板里标出「这条发往哪台机的哪个会话」；本机行去掉跨机按钮；等待预算 120s→300s，超时文案改成"不是失败" |
| `patch-peer-sync-sidebar.mjs` | 把「跨机同步」放进左侧边栏（原来藏在 设置→插件 里） |
| `patch-peer-sync-shell.mjs` | 作为独立页面时的留白、内容限宽、标题字号 |
| `patch-peer-sync-host.mjs` | 服务端等到这一轮真正结束才返回，避免把开场白当答案 |
| `patch-peer-sync-workdir.mjs` | 远程派活的会话默认落在指定工作目录（目录不存在时不硬塞） |
| `patch-device-mesh-ui.mjs` | 在线徽标改成 7px 小圆点；点本机会话时自动收起远程面板 |
| `patch-peer-sync-utf8-name.mjs` | **修真实缺陷**：机器名含中文时，`x-peer-name` 头非法导致所有出站请求抛 ByteString 错、整条链路显示「不可达」。发送端编码、接收端解码 |
