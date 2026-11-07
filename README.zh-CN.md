# Rig Studio

[English](README.md) | **简体中文**

开源版 0.3.1 基于独立的 v0.3.0 桌面版，增加英文／简体中文界面。首次启动默认英文，可在画布顶部、经典工作台顶部或应用设置中切换，选择会保存在本机。切换不会重新创建画布、重置预览或更改用户输入。

Windows / macOS 桌面角色制作工作区：节点画布、模型生成、骨骼绑定、动作对比，以及可以实际编辑 Blender 工程的 Agent。处理使用本机 Blender，AI 使用用户配置的 OpenAI 兼容接口。

## 开始使用

先安装 Node.js 24+ 和 Blender，然后从源码启动：

```bash
git clone https://github.com/laputacn/RigStudio.git
cd RigStudio
npm ci
npm run build
npm start
```

1. 也可以使用源码中的 `start-windows.cmd` 或 `start-macos.command` 安装依赖、构建并启动。若自行打包，Windows 运行 `Rig Studio.exe`；macOS 运行 `Rig Studio.app`。本版本没有在 Mac 实机验收。
2. 在设置中选择本机 Blender。支持 4.2+，v0.3.0 的原始验证记录使用 Linux 4.5.3 和 Windows 5.2.1。Windows 应选 `blender.exe`；误选 `blender-launcher.exe` 会自动转换。Mac 可选 `/Applications/Blender.app/Contents/MacOS/Blender`。
3. 填写 API 地址、模型名和 Key。官方 `https://api.openai.com/v1` 自动使用 Responses；兼容服务默认 Chat Completions，也可手动选择。模型需要支持图片和函数工具调用。连接测试仅测试文字请求。
4. 导入带动作的原型，以及目标外观 GLB；或者添加 Tripo / Meshy 生成节点。
5. 添加绑定节点，将原型接到「原型」端口，目标接到「目标」端口。选中绑定节点，让 Agent 分析并绑定，或在「节点设置」创建草案、选择动作后执行。
6. 结果自动成为独立节点。点击节点卡片上的「+ 对比」将多个版本加入对比，或创建编辑节点继续修改。点击「分支」继承原节点输入与方案，保留所有已有结果。

无需平台注册或登录，不使用平台积分、会员或云端项目存储。AI 与生成服务使用你自己的 API Key，各服务费用由服务商收取；手动绑定、对比和模型文件保存在本机。

旧版设置、模型库和结果保留；首次启动会将旧资产/绑定记录迁移为画布节点。「经典工作台」仍可使用原来的详细关节编辑界面。升级不会重做既有模型。

## 画布与对比

节点类型：动作原型、目标模型、生成模型、绑定动作、Blender 编辑、结果版本。连线有类型和循环检查，每个输入端口只接收一个模型。移动节点、连线、修改描述不会自动执行任务。删除画布节点只移除画布记录，模型和处理文件保留。

节点使用静态缩略图；画布视野外的节点不绘制卡片。3D 仅加载在固定对比区，最多三个模型，可比较原型 / v1 / v2。统一动作名称、归一化相位和相机视角；模型缺少对应动作时明确显示静止提示。支持慢放、暂停、拖动进度、骨架叠加、统一显示高度或实际尺寸。统一显示高度只用于观察，不修改 GLB 尺度。

缩略图按资产缓存。Three.js 在姿态/视角/尺寸变化时绘制，后台窗口暂停绘制；切换模型释放纹理、骨架和网格。Agent 截图窗口仅在检查期间加载模型。画布 JSON 存节点、连接、参数和资产引用，不内嵌 GLB 或纹理；分支复用输入。Blender 串行执行，临时输入副本在进程结束后清理。

## Agent 操作 Blender

在画布选中节点后直接说：

- “先检查当前模型的双臂网格，局部延长 15%，肩部自然过渡，保留旧版本。”
- “查看跑步 25%、50%、75% 的姿态，检查胸颈的权重，再新建一个修正版。”
- “检查 UV 密度和真实贴图，用棋盘格渲染对比有没有明显拉伸。”
- “给这个模型制作眨眼和张嘴形态键，保存新的编辑版本。”
- “从当前绑定方案创建分支，重新调整关节；使用原始目标网格重新绑定。”
- “先不要执行，解释这个方案的骨骼对应。”

实际工具包括画布检查/建节点/连线/分支/切换节点、模型与动作截图、绑定方案编辑、执行绑定、生成模型、Blender 场景详细检查以及 `execute_blender_python`。

Blender 编辑脚本可以使用 `bpy`、`bmesh`、`mathutils`、`numpy` 等，编辑网格、静止骨架、局部权重、UV、材质、贴图像素、形态键、约束、动画和烘焙。不是只移动绑定方案的骨骼。每次编辑在新副本执行，保存 GLB、打包的 `.blend`、Python 脚本、日志、检查报告。可以从结果打开 Blender 工程或结果目录。

`inspect_blender_scene` 与编辑读取同一工程，返回实际 Blender 对象名称、区域顶点采样/权重、UV 密度、材质、贴图和形态键。支持真实贴图预览、指定动作相位的多视角 CPU 渲染、临时 UV 棋盘格渲染。渲染图和工具报告返回模型，模型可据此继续修正。

内置辅助接口：

```python
# 所有 region 和 stretch 参数使用模型的 WORLD glTF +Y-up 坐标。
# bpy 原生数据为 Blender +Z-up；网格 .co 还处于对象局部坐标。
scene_info = studio.inspect()
ob = studio.mesh('实际检查获得的对象名')
world_gltf = to_gltf(ob.matrix_world @ ob.data.vertices[0].co)

# 沿 X 轴，以 pivot 为起点；在 start 到 end 距离内平滑过渡。
# 只适合已经确认区域和方向的模型，不是通用双臂参数。
studio.stretch(ob.name, axis=0, pivot=0.4, start=0, end=0.3,
               factor=1.15, side=1, move_bones=True)
studio.report['change'] = '记录实际测量和改动'
studio.render('front', checker=True)
studio.texture_preview('实际贴图名称')
```

`studio.stretch` 同步修改现有形态键，按参数可适配静止骨骼；它不自动解决所有权重、关节旋转轴或动作穿插。Agent 必须按实际模型定位区域、检查结果，不能照搬测试模型或 dog1 的数值。新建表情、UV 修复等能通过脚本执行，效果仍取决于模型拓扑、纹理布局和所选 AI 的判断。

执行前有脚本模块/属性检查，拒绝常见系统命令、网络和任意文件接口；子进程不继承名称包含 Key/Token/Secret 等的环境变量。原资产复制后才处理。**这些是应用防误操作措施，不是操作系统级 Python 安全沙箱**；不要运行不可信来源的脚本。没有实现鼠标控制 Blender 界面，也不保证依赖 UI 上下文或额外插件的所有操作都能在后台运行。

GLB 不支持的约束、修改器或复杂材质必须应用/烘焙；`.blend` 保留工程数据。导出后重新读取，并检查网格有限数值、蒙皮覆盖、原有动作名称和时长。脚本失败、无有效网格、蒙皮丢失或未授权删除动作时不发布成功版本。检查通过只证明相应数据检查通过，不代表所有动作、穿插和纹理质量已通过视觉验收。

## 步数、历史和停止

设置提供 12 / 24 / 48 步及自定义 1–100 步，默认 24。另有每轮 Blender 编辑/绑定尝试数 1–30，默认 6。一步是一次模型决策请求，不是动作数，也不等于 Blender 运行次数。达到上限保留已完成结果，可以继续发指令。

画布对话按节点独立保存；新分支继续操作时保留相关上下文。经典工作台仍按原型/目标配对保存。模型看到当前选中节点及其输入/方案/结果，不默认发送全部 GLB。对话、结构数据和检查图片会发往配置的 API；生成服务收到填写的模型描述。图片不内嵌在历史 JSON；模型 Key 与生成服务 Key 只留在主进程，可选择系统安全存储加密保存。

停止会中断当前 API 请求和本地 Blender，已完成的版本保留。每次本地任务最长 30 分钟；生成查询最长 45 分钟，超时后保留远程任务编号。

## Tripo / Meshy

在设置填写相应服务的 API Key。在生成节点填写提示词、选择服务和模型版本，保存后点击生成。Agent 只有在用户明确要求生成时才应提交收费任务。

- Tripo：v3 `generation/text-to-model` 与 `tasks/{id}`，默认 `v3.1-20260211`，版本可改。
- Meshy：`openapi/v2/text-to-3d`，先 preview、再 refine 生成纹理，默认 `meshy-7.1`，版本可改。
- 下载结果为 GLB，限制 512 MB。下载请求不发送服务 API Key 到模型 CDN。
- 任务编号提交后立即保存；中断/重启后点击“继续查询原任务”。停止本地等待不等于取消服务端生成，远程任务可能继续计费。已有任务不会因重试按钮重新提交；新生成使用新分支。
- 如果创建任务的网络请求超时且未收到任务编号，请先在服务商控制台查看，避免重复提交。

适配依据：[Tripo 文档](https://developers.tripo3d.ai/en/docs/quick-start)、[Meshy 文档](https://docs.meshy.ai/en/api/text-to-3d)、[OpenAI 工具调用](https://developers.openai.com/api/docs/guides/function-calling)。本次验证使用模拟模型响应/生成接口，不消费用户的真实 API 额度；第三方收费生成尚未进行真实账户端到端验收。

## 构建与验证

```bash
npm ci
npm test
npm run build
npm run dev
npm run dist:win:portable
# 在 Mac 本机生成安装包：
npm run dist:mac
```

跨平台前端为 React / React Flow / Three.js；Electron 主进程管理文件、密钥、API 和任务；Blender Python 负责模型处理。`desktop/workflow.mjs` 保存图；`desktop/agent.mjs` 是工具循环；`desktop/editing.mjs` 与 `blender/editor.py` 是编辑通道；`blender/worker.py` 保留原绑定流程。

验证：

- `npm test`：绑定参数、API 协议、密钥存储、取消、工具限制、图连接/分支、独立历史、自定义步数、生成任务续查以及翻译覆盖。
- `npm run test:ui`：构建后运行，使用隔离的 Electron 用户目录检查英文默认值、中英文切换、设置草稿保留、节点操作、原生窗口文案和重启恢复。不调用真实 AI 或生成接口。
- `tests/fixtures/character.glb` 是通过 `scripts/make-editor-fixture.py` 创建的简单几何测试模型，包含 Wave 动作，不包含用户模型。

UI 测试可用 `ELECTRON_PATH` 指定本机 Electron 可执行文件；Linux root 环境通过 `RIG_TEST_NO_SANDBOX=1` 显式启用无沙箱测试，勿将此选项用于普通使用。

这条历史分支提供步数和 Blender 尝试次数限制，没有后续版本中的 Token 或金额预算保护。骨架报告、历史对话和截图仍可能产生较多输入 Token；长任务前应在服务商侧设置额度限制。点击 API 连接测试也会产生一次模型请求。

Windows / macOS 打包入口保留；macOS 尚未在实机验证。公开源码不包含用户工作区、个人配置、密钥、安装包或第三方角色模型。

## 开源许可

本项目自有代码按 [MIT License](LICENSE) 发布。第三方依赖使用各自许可证；Blender 独立安装，其许可不随本仓库改变。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
