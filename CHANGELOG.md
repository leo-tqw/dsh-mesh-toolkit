# Changelog

## 0.1.0 — 2026-11-19

首个版本，来自作者两台 Mac（Mac mini 主机 + MacBook 随身）实际跑通的配置。

- `mesh_status`：一次体检 peer-sync 与 device-mesh 的状态
- `mesh_setup`：配置对齐 + 补丁重打（默认只读，`apply: true` 才写）
- `mesh_network`：跨网可用性诊断（监听绑定 / 对端地址 / 端点是否含 tailnet）
- `mesh_send_file`：跨机文件传输 + sha256 校验
- `mesh-workflow` 技能：执行地判断、产物落盘、故障对照表
- `patches/`：七个可选的本地补丁（含非 ASCII 机器名的 ByteString 缺陷修复）
