# 前后端信息/文件传输决策文档（双层版）

> Audience
> - Layer A: Owner View（白话可读）
> - Layer B: Engineering Spec（实现规范）
>
> Scope
> - Agent mode only（不改 chat mode）
> - 目标是让外部 Claude Code backend 与本地 naive agent 在“上下文输入能力”上对齐

---

## Layer A — Owner View（白话可读）

### 1) 这次我们要解决什么

目前外接 Claude Code 的 Agent 模式里，前端虽然能看到你添加了论文、附件、截图、选中文本，但后端很多时候只收到一句用户输入文本，导致：

- 当前论文上下文丢失或变成摘要
- 附件/截图看起来“挂上了”，但后端无法真正使用
- queue 与正常发送在“带上下文”时行为不一致

这次决策定为：**`run-turn v2` 采用完整透传（full passthrough）作为主路线**。

### 2) 你在前端做操作后，Claude Code 将实际收到什么

| 你在前端做的事 | Claude Code 收到的内容 | 预期效果 |
|---|---|---|
| 只输入文本 | `userText` + 会话标识 + 当前条目定位 | 普通问答 |
| 添加论文上下文 | `selectedPaperContexts/fullTextPaperContexts` | 明确知道是哪篇论文与哪种读取模式 |
| 选中一段文本 | `selectedTexts + selectedTextSources`（含来源定位） | 精确围绕你选中的段落分析 |
| 添加截图 | `screenshots`（图像句柄）+ 图像摘要回退 | 能看图则看图，不能看图也有兜底文本 |
| 添加附件 | `attachments`（可读句柄）+ 摘要回退 | 能直接读文件则深读，不能读则至少用摘要回答 |
| 组合操作（论文+附件+截图+文本） | 同一回合完整上下文包 | 不再“看起来加了但后端没收到” |

### 3) 失败时用户会看到什么（可预期）

- 文件不可读（路径无权限/不存在）: 不中断整轮，状态提示“已回退摘要模式”。
- 图片不可用（模型或通道不支持）: 回退到图片摘要或 OCR 文本。
- 后端暂不支持某字段: 该字段降级，不影响文本主回答。
- queue 条目发送失败: 该条标记失败并可重发，不影响你正在输入的草稿。

### 4) 交互规则（拍板）

- queue 条目是**独立消息快照**（message snapshot），不是借用输入框当前状态。
- queue dispatch 不覆盖、不清空输入框草稿。
- Send 按钮在以下任一条件满足时可点：
  - 有文本
  - 有截图
  - 有附件
  - 有论文上下文

---

## Layer B — Engineering Spec（实现规范）

### 1) 协议策略

#### 1.1 主路线

`run-turn v2` 使用完整透传，字段与 `AgentRuntimeRequest` 对齐，避免语义丢失。

- v2 request carries:
  - conversation / identity: `conversationKey`, `activeItemId`, `libraryID`
  - user input: `userText`
  - text context: `selectedTexts`, `selectedTextSources`, `selectedTextPaperContexts`, `selectedTextNoteContexts`
  - paper context: `selectedPaperContexts`, `fullTextPaperContexts`, `pinnedPaperContexts`
  - file/image context: `attachments`, `screenshots`
  - run config: `model`, `apiBase`, `apiKey`, `authMode`, `providerProtocol`, `reasoning`, `advanced`
  - optional context: `activeNoteContext`, `history`, `systemPrompt`

#### 1.2 兼容策略（v1 + v2 并行期）

- Bridge 先探测后端是否支持 v2（capability flag / version header）。
- 支持 v2: 发送完整 payload。
- 不支持 v2: 回退 v1（`userText + metadata.contextEnvelope`），并在状态区明确提示“降级模式”。

### 2) 字段矩阵（Current vs Target）

| 字段 | Current（external） | Target（v2） |
|---|---|---|
| `selectedTexts` | 摘要截断 | 完整透传 |
| `selectedText*Contexts` | 基本缺失/弱化 | 完整透传 |
| `selectedPaperContexts/fullTextPaperContexts` | 摘要化 | 完整透传（含定位字段） |
| `attachments` | 仅元信息（name/mime/size） | 透传可读句柄（`storedPath/contentHash/textContent?`） |
| `screenshots` | 仅数量 | 透传图像句柄（data URL/path/ID） |
| `activeNoteContext` | 预览截断 | 完整结构透传（按长度上限裁剪正文） |
| `history/systemPrompt/item` | 基本不透传 | 按策略可选透传 |

### 3) Claude SDK 输入通道策略

#### 3.1 Mixed Strategy（已拍板）

- Primary: text + structured metadata for deterministic context.
- Secondary: file/image handles for deep read.
- Fallback: summarize to plain text when handle cannot be consumed.

#### 3.2 文件/图片处理决策

- 图片：优先结构化多模态输入；不支持时回退摘要/OCR 文本。
- PDF：优先可读句柄 + 工具读取；必要时回退文本摘要。
- 其他附件（csv/xlsx/docx/md/txt）：
  - 可解析文本则前端预抽取文本并透传。
  - 不可解析则透传句柄并允许后端用工具读取。

### 4) Send 与 Queue 规范

#### 4.1 Send availability

`canSend = hasText || hasScreenshots || hasAttachments || hasPaperContexts`

#### 4.2 Queue snapshot

- queue entry payload is immutable snapshot:
  - `text`, `selectedTexts*`, `paperContexts*`, `attachments`, `screenshots`, `config`
- dispatch uses queue snapshot only; no dependency on current input draft.
- success -> dequeue immediately; failure -> mark failed + retry CTA.

### 5) 安全边界

- 路径访问受后端可读目录策略约束（allowlist / project boundary）。
- 不可读文件不阻断主回答；只降级该文件。
- 禁止将敏感路径全文暴露到用户可见消息；仅显示安全化错误提示。

### 6) 验收用例（必须通过）

1. text only
2. screenshot only
3. attachment only
4. text + attachment
5. text + selected snippet (+source)
6. paper context + attachment
7. queue with attachment/screenshot snapshot

每个用例都要验证：
- UI: Send 按钮状态正确
- Bridge: payload 含预期关键字段
- Adapter: query input 实际消费到这些字段
- UX: 失败可回退且不阻断主流程

---

## 附：实现默认值（Defaults）

- 文档语言：中文主文 + 英文术语对照
- 优先级：先打通“信息真实到达后端”，后做体验精修
- 范围：仅 Agent mode，chat mode 不动
