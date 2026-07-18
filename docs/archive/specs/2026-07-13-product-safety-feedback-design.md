# 产品安全与反馈设计

## 目标

在不扩大 Pi RUNNER MVP 边界的前提下，补齐逻辑移除恢复、历史刷新反馈、设置保护、安装确认和连接恢复状态。所有高影响动作必须由 Backend 守卫，Renderer 负责清楚表达状态。

## 历史刷新

- 从 ChatHeader 移除刷新按钮，放到 Sidebar 的“会话”标题右侧。
- 任一 runner 处于 `starting`、`running` 或 `stopping` 时，侧边栏和命令面板的刷新都禁用。
- Backend 再次检查 runner 列表；竞态下不执行 sync，并返回专用失败事件。
- 手动刷新携带 `requestId`；agent-end 自动同步不携带，避免错误 Toast。
- 刷新期间入口禁用并旋转；成功提示更新数量或“未发现新的会话”，失败说明现有列表已保留。

## 移除撤销

- Backend 确认移除后，成功 Toast 提供 8 秒“撤销”。
- 撤销发送 `restore_conversation` 或 `restore_workspace`，Backend 删除 hidden metadata 后返回确认和最新列表。
- Renderer 只恢复本次移除的会话，不覆盖期间发生的其他列表变化；本地未启动会话也可以撤销。
- 恢复不启动 runner、不修改 Pi JSONL 或工作区文件。

## 设置与安装保护

- 设置存在未保存草稿时，返回操作显示“继续编辑 / 放弃修改 / 保存并返回”。
- `settings:save_all` 在 Backend 先校验两份 JSON，再写入需要保存的文件并返回一个 snapshot。
- Renderer 把未保存状态同步给 Electron main；真正退出时提示会丢失设置，关闭窗口仍只隐藏。
- “一键安装”先显示来源、命令影响和“取消 / 继续安装”，确认后才发送现有安装意图。

## 连接状态

- Renderer 使用 `connecting`、`connected`、`reconnecting`、`offline` 四态。
- WebSocket client 仍按现有指数退避自动重连，不新增 Backend 协议。
- Header 显示“正在连接 / 已连接 / 正在重新连接 / 连接失败，自动重试”，入口禁用仍由 connected 布尔值决定。
- 连续失败进入 offline，后续重试和恢复连接会继续更新状态。

## 验证

- 协议、Backend handler、Renderer composable、Electron policy 和组件源码契约均使用 TDD。
- 完成后运行全量测试、生产构建、构建产物检查和 Apple Silicon `.app` 打包。
