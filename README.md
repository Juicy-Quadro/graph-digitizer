# Graph Digitizer · 图表数字化工具

把图片里的曲线变成可用的数据表。Windows 桌面应用（Electron），界面中英双语可随时切换。

> A Windows desktop application that turns curves inside images into real data
> tables. Four point calibration, automatic line tracing and area sampling,
> with export to eight formats.

![Graph Digitizer](screenshots/trace-en-dark.png)

| | |
|---|---|
| ![中文界面](screenshots/drag-zh-light.png) | ![设置](screenshots/settings-auto-auto.png) |
| 中文界面 · 区域取点 | 设置：语言 / 主题（跟随系统） |

---

## v1.1.0 更新

- **界面全面重做**：统一设计 token、深浅双主题重新调校、数据表重做（数值右对齐 + 等宽数字 + 斑马纹）、空状态重做并加入**三步引导卡**
- **掩膜开关与透明度真正生效**（此前是死控件），叠加层在深色图上也清晰可见
- **改标定后自动重算**所有已数字化点的逻辑坐标
- **打开新图自动清空**上一张图的标定与数据，避免导出张冠李戴
- **系列重命名改用应用内弹窗**（Electron 不支持 `window.prompt`，此前永远失败）
- 不再提供 TIFF（Chromium 无 TIFF 解码器），万一拖入会给出明确提示

完整改动清单见 [`docs/UX-PRIORITIES.md`](docs/UX-PRIORITIES.md)，
缺陷审计见 [`docs/AUDIT-2026-10-25.md`](docs/AUDIT-2026-10-25.md)。

---

## 快速开始 · Quick start

**方式一：免安装便携版**
下载 `GraphDigitizer-1.0.0-portable.exe`，双击即用，不写注册表、不装任何依赖。

**方式二：安装版**
运行 `GraphDigitizer-1.0.0-x64.exe`，可自选安装目录，自动创建桌面与开始菜单快捷方式。

**方式三：从源码运行**

```bash
npm install
npm start
```

---

## 界面语言与主题 · Language & theme

界面**中英双语**，主题**默认跟随系统**。三处入口，任选其一：

| 位置 | 操作 |
|---|---|
| 标题栏右上角 | `EN │ 中文` 分段开关，点一下立即切换 |
| 标题栏齿轮按钮 / `Ctrl+,` | 打开**设置**面板，里面有「语言」与「主题」两组单选 |
| 原生菜单 | `View → Language` 切语言，`View → Theme` 切主题 |

### 语言
- **首次启动按操作系统语言自动判定**（中文系统 → 中文界面，英文系统 → 英文界面）
- 选择结果会记住，下次启动沿用
- 切换**即时生效**，不用重启

### 主题
- 三个选项：**跟随系统 / 深色 / 浅色**
- 默认「跟随系统」——Windows 切到浅色或深色，**应用会自动跟着变**（约 1 秒内）
- 一旦手动选了「深色」或「浅色」，就不再跟随系统，钉住你的选择
- 标题栏那颗主题按钮会在 跟随系统 → 浅色 → 深色 之间循环，图标同步变化
- 主题切换时，Electron 原生标题栏的配色也会跟着变（深色时深底浅图标）

---

## 五个步骤，把图变成数据 · The five steps

### 1. 打开图片 — Open Image
拖放或点击 `Open Image`（Ctrl+O）。支持 PNG / JPG / BMP / GIF / WEBP。

> TIFF 暂不支持：Electron 内置的 Chromium 没有 TIFF 解码器。与其让你选一个打不开的文件，不如现在就说清楚。

### 2. 设置标定 — Set Scale（快捷键 `S`）
依次在图上点四个点：**Xmin → Xmax → Ymin → Ymax**，然后在右侧面板给每个点填入真实数值。

这四点的定义：

| 标定点 | 含义 |
|---|---|
| `Xmin` | X 轴的起点，填该位置对应的逻辑 X 值 |
| `Xmax` | X 轴的终点，填该位置对应的逻辑 X 值 |
| `Ymin` | Y 轴的起点，填该位置对应的逻辑 Y 值 |
| `Ymax` | Y 轴的终点，填该位置对应的逻辑 Y 值 |

**两点轴不要求垂直、也不要求与图像边缘平行** —— 程序按两条轴向量构建仿射变换，所以倾斜的坐标系、三维旋转投影出来的图都能处理。

X 轴或 Y 轴选 `Logarithmic` 即为对数刻度（两个端点值都必须大于 0）。

不想标定？点 `Use pixel coordinates` 直接用像素坐标。

### 3. 指定曲线颜色 — Pick Line Colour（`L` / `B`）
用 `Line Colour` 工具点一下曲线采样线色，用 `Background Colour` 点一下空白处采样背景色。
也可以点 `Auto Detect` 让程序自动猜（背景取出现最多的颜色，线色取与背景差异最大的主色）。

右侧 `Curve Detection` 面板可调：
- **Identification method** — `By colour`（按颜色）/ `By intensity`（按灰度，适合黑白线条图）/ `Combined`（组合）
- **Tolerance** — 容差。曲线与背景色接近时调大
- **Ignore features smaller than** — 过滤掉小于 N 像素的碎点（地图、扫描件的噪点）
- **Curve thickness** — 曲线加粗 1–4 像素，扫描件里只有 1 像素宽的线时很有用
- **Show detection mask** — 把识别结果半透明叠加在原图上，所见即所得

### 4. 取点 — Digitize

**A. Auto Trace（`T`）** —— 适合实线
点一下曲线起点，程序沿曲线追踪。遇到交叉点时优先走直线方向。
参数：`Maximum gap`（允许跨越的最大断点，虚线要用）、`Smoothing`（平滑）、`Point spacing`（取点间距，0 = 逐像素）。

**B. Digitize Area（`G`）** —— 适合虚线、任意形状
在图上拖出一个矩形区域，程序在区域内生成采样线并与曲线求交。
参数：
- `Grid` — `Pixels`（图像像素网格）/ `Logical X` / `Logical Y`（按标定后的逻辑坐标等距，受标定控制）
- `Spacing` / `Offset` — 网格间距与相位
- `Point placement` — `Middle of the curve`（曲线中线）/ `Area boundary`（区域边界）
- `Rotation` — 矩形网格旋转角，斜曲线用它

**C. Add Point（`P`）/ Erase Point（`E`）** —— 手工补点、删点

### 5. 导出 — Export（Ctrl+E）
支持 **CSV / TXT / Excel(XML) / XML / JSON / SVG 图表 / AutoCAD DXF / PostScript EPS**。
`Copy` 一键把数据以制表符分隔复制到剪贴板。

`Save`（Ctrl+S）保存工作区（`.gdw`，JSON 格式，含标定、系列、采样参数）。

---

## 界面说明 · Interface

```
┌──────────────────────────────────────────────────────────────────┐
│ 标题栏：打开 / 保存 / 导出 / 撤销 / 重做 / 语言 / 主题            │
├────┬─────────────────────────────────────────┬───────────────────┤
│工具│                                         │  检查器面板        │
│ 栏 │              画布视口                    │  标定/曲线识别     │
│    │                                         │  追踪/区域采样     │
│    │                                         │  导出              │
├────┴─────────────────────────────────────────┴───────────────────┤
│ 数据表（可排序、可双击编辑、可选中删除）                            │
├──────────────────────────────────────────────────────────────────┤
│ 状态栏：光标像素坐标 · 逻辑坐标 · 缩放 · 点数                       │
└──────────────────────────────────────────────────────────────────┘
```

- 滚轮缩放（以光标为中心），`Ctrl+滚轮` 精细缩放，空格+拖动平移
- 数据表与画布联动：选中表格行，画布上对应点高亮
- 底部数据表可折叠

---

## 键盘快捷键 · Keyboard shortcuts

| 键 | 功能 |
|---|---|
| `V` `S` `L` `B` `T` `G` `P` `E` | 查看 / 标定 / 取线色 / 取背景色 / 自动追踪 / 区域取点 / 加点 / 删点 |
| `Space` + 拖动 | 平移画布 |
| 滚轮 / `Ctrl+滚轮` | 缩放 / 精细缩放 |
| `F` · `Ctrl+0` · `Ctrl+1` | 适应窗口 / 适应窗口 / 实际大小 |
| `Ctrl+Z` · `Ctrl+Y` | 撤销 / 重做 |
| `Delete` | 删除选中的点 |
| `Ctrl+O` `Ctrl+S` `Ctrl+E` `Ctrl+C` | 打开 / 保存 / 导出 / 复制 |
| `Ctrl+M` | 显示或隐藏识别掩膜 |
| `Esc` | 取消当前操作 |

---

## 算法说明 · How it works

**标定**：由 Xmin→Xmax 和 Ymin→Ymax 两条轴向量构建仿射变换。

```
u = ((p − Xmin) · ax) / (ax · ax)     → X 轴归一化位置
v = ((p − Ymin) · ay) / (ay · ay)     → Y 轴归一化位置
X = interp(xminValue, xmaxValue, u)   （对数轴时在 log 空间插值）
```

**曲线识别**：逐像素计算与线色/背景色的「redmean」感知色距，二值化成掩膜；支持颜色 / 灰度 / 组合三种判据，可过滤小连通域、可膨胀加粗。

**自动追踪**：在掩膜上做方向感知的 8 邻域行进。每步在邻域内选择与当前方向夹角最小的候选像素（因此交叉点处会直行穿过）；无候选时沿当前方向前瞻至多 `Maximum gap` 像素寻找断点另一侧，并约束跳跃方向与横向偏移，避免回跳振荡。最后用 Douglas-Peucker 简化并按弧长重采样。

**区域取点**：在矩形窗口（可旋转）内生成采样线，用 slab 法与窗口求交，沿线以 0.4 像素步进扫描掩膜，记录每一段命中；取点位置取命中段中点或首端（区域边界）。

---

## 精度验证 · Validation

测试脚本：`tools/algorithm-test.js`（`node tools/algorithm-test.js`），覆盖标定、掩膜、追踪、区域取点、导出器五组共 **50 项断言**。

验证数据来自 GetData Graph Digitizer 2.26 自带的样例图与 `.gdw` 工作区 —— 工作区里保存了原程序自己提取的真值坐标。

| 样例 | 内容 | 结果 |
|---|---|---|
| `sample3.pcx` | 三维旋转坐标系 + 蓝色曲线 | **100% 真值点误差 ≤ 2 px，平均 0.80 px** |
| `sample1.jpg` | 地形图，1 像素宽红色公路 | 掩膜可分离，追踪受同色地形干扰 |
| `sample2.tif` | 六条同色不同线型的多系列图 | 标定管线有效；色度法无法区分同色系列（固有局限） |

标定管线在三个真实工作区上单独验证：标定有效、所有真值点映射为有限逻辑值、像素往返误差 < 1e-13 px。

---

## 目录结构 · Project layout

```
electron/          主进程（窗口、原生菜单、文件对话框 IPC）
  main.js
  preload.js       contextBridge 安全桥接
src/
  index.html       界面骨架
  styles.css       主题变量与全部样式（深/浅色）
  js/
    i18n.js        en / zh-CN 词典
    state.js       状态仓库 + 撤销/重做
    app.js         装配层：工具、快捷键、菜单、导入导出
    core/
      geometry.js  几何工具（简化、平滑、重采样、裁剪）
      calibrate.js 四点标定（仿射 + 对数轴）
      mask.js      曲线识别掩膜
      trace.js     自动追踪
      area.js      区域采样
      exporters.js 八种导出格式
    ui/
      canvas.js    画布渲染与交互
      table.js     虚拟化数据表
tools/
  algorithm-test.js        算法测试
  build_fixtures.py        从 GetData 样例生成真值夹具
  capture.js               自动截图
  make_icon_and_fixtures.py
build/icon.ico            应用图标
```

## 构建 · Building

```bash
npm install
npm run dist      # 生成 NSIS 安装包 + 便携版 exe，输出到 release/
npm run pack      # 只解包目录，不生成安装包
```

环境要求：Node.js 22.19+ / 24.11+ / 26+。

## 许可 · License

MIT
