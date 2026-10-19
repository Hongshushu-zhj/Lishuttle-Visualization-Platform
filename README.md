# 天线覆盖绘图平台

读取仿真结果，调用 MATLAB 生成室内/室外覆盖图，支持多高度层、结果对比和图片下载。绘图脚本已包含在 `matlab/` 中，部署时复制整个项目目录即可，仿真数据可放在其他位置。

## 1. 部署与启动

运行环境：Windows、Node.js 20.19+（建议 22 LTS）、MATLAB（本项目已在 R2022a 验证，需要可用许可）。首次安装依赖需要联网。

1. 下载或克隆项目，打开包含 `启动平台.bat` 的目录。
2. 将 `backend/config.example.json` 复制为 `backend/config.json`，修改 `matlabExe` 为本机 MATLAB 路径。已有配置时直接编辑即可。
3. 双击 **`启动平台.bat`**。首次运行会安装依赖、构建前端并启动服务。
4. 浏览器打开 **http://127.0.0.1:8000**。
5. 停止服务时双击 **`停止平台.bat`**。关闭启动提示窗口不会停止后台服务，重启电脑后需要重新启动。

配置项说明已写入 JSON 的 `_说明` 等字段，不影响配置读取：

| 配置项 | 如何填写 |
|---|---|
| `matlabExe` | MATLAB 可执行文件完整路径，例如 `D:/Matlab/R2022a/bin/matlab.exe` |
| `port` | 默认 `8000`；修改后还需同步两个启动/停止脚本中的 `PORT`，访问地址也使用新端口 |
| `maxConcurrentJobs` | MATLAB 同时运行的进程数，建议保持 `1` |

修改配置后重启服务。`config.json` 是本机配置，不随 Git 提交；换机器时需重新配置。

## 2. 绘图时应该打开什么

点击页面中的 **“添加”**，选择**仿真结果文件夹**。所选目录必须包含 `pred/0/index.txt`。

例如文件在：

```text
D:/仿真结果/案例A/pred/0/RSRP_1.dem
```

应选择 **`D:/仿真结果/案例A`**。不要选择 `pred`、`0`、单个 `.dem`、`.ils` 或 MATLAB `.m` 文件，也不要选择已经导出的“路损结果图”目录。

添加后，选择数据源、数据类型与高度层/楼层，点击 **“开始绘图”**。多源对比时，在“结果对比”页选择至少两个数据源及它们共同的数据类型。

### 室外结果

```text
案例A/
└─ pred/
   └─ 0/
      ├─ index.txt          # 必需：UTM 标记、数据文件名、坐标范围和分辨率
      ├─ RSRP.dem           # 地面数据，按所需类型提供
      ├─ DLRSSINR.dem
      ├─ building1          # 可选：建筑轮廓，无扩展名
      ├─ cells1.txt         # 可选：基站位置
      └─ 10m/
         └─ RSRP.dem        # 10m 高度数据，其他高度同理
```

- `index.txt` 包含以 `UTM` 开头的行时，识别为室外。
- 数据记录格式：`文件名.dem 左边界 右边界 下边界 上边界 分辨率`。
- 高度层来自 `pred/0/` 下包含对应 `.dem` 的子目录，例如 `10m`、`20m`；直接放在 `0/` 下的是地面数据。
- 建筑和基站文件始终放在 `pred/0/`，高度层绘图也读取这里的叠加文件。

### 室内结果（常称路损/覆盖结果）

```text
案例B/
├─ pred/
│  └─ 0/
│     ├─ index.txt          # 必需：不含 UTM 标记，使用局部米制坐标
│     ├─ RSRP_1.dem         # 1层 RSRP
│     ├─ RSRP_2.dem         # 2层 RSRP，可选
│     └─ DLRSSINR_1.dem
└─ out.txt                 # 可选：墙线；也支持下述其他文件名
```

- `index.txt` 不含 `UTM` 标记时，识别为室内。每条记录可写为 `左 右 下 上 分辨率`，或 `文件名.dem 左 右 下 上 分辨率`。
- 楼层来自文件名后缀：`RSRP_1.dem` → RSRP、1层；没有数字后缀时记为单层。
- 墙线先在所选结果文件夹查找，再在 `pred/0/` 查找；每个目录按 `walls.txt`、`wall.txt`、`building.txt`、文件名含 `floor` 的 `.txt`、文件名含 `wall` 的 `.txt`、`out.txt` 的顺序选择。
- 普通墙线每行四列：`x1 y1 x2 y2`，支持 `%` 注释；也支持“块编号 数量”头后接指定数量的“编号 x1 y1 x2 y2”记录。墙线坐标应与栅格数据一致。

### 支持的数据类型

| 类型 | 室外文件示例 | 室内文件示例 | 含义 |
|---|---|---|---|
| RSRP | `RSRP.dem` | `RSRP_1.dem` | 参考信号接收功率 |
| DLRSSINR | `DLRSSINR.dem` | `DLRSSINR_1.dem` | 下行参考信号信干噪比 |
| SCR | `SCR.dem` | `SCR_1.dem` | 信杂比 |
| ECHORP | `ECHORP.dem` | `ECHORP_1.dem` | 回波接收功率 |
| BESTSERVER | `BESTSERVER.dem` | `BESTSERVER_1.dem` | 最佳服务小区编号 |

`.dem` 为二进制 int16 栅格，`-32768` 表示无效值；功率/信噪比数据按存储值除以 100，小区编号保持整数。各类型按实际文件提供，不要求全部存在。

**RSRP 是接收功率，不是路径损耗本身。** 如果你所说的“路损文件”是 `PathLoss.dem`、`PL.dem` 等其他名称或格式，目前没有对应的绘图类型，不能直接改名为 RSRP 使用；需要先确认数据含义并增加适配。

## 3. 结果保存与常见问题

生成的图片保存在原结果文件夹中：

```text
案例A/路损结果图/数据类型/图片名称.png
```

页面支持单张下载、批量 ZIP 导出和打开结果文件夹。相邻的 `.meta.json` 用于缓存判断，建议随图片一起保留。数据或索引、墙线、建筑、基站文件变化后，下次绘图会检查缓存并按需重新生成。

- **无法出图**：检查 `config.json` 中 MATLAB 路径、MATLAB 许可及页面任务错误提示；MATLAB 首次启动可能需要几十秒。
- **没有识别到数据**：确认添加的是包含 `pred/0/index.txt` 的结果文件夹，索引记录与实际 `.dem` 文件对应。
- **没有墙线或建筑**：确认文件名、存放位置、文件格式及坐标系符合上面的约定。
- **启动失败**：在项目目录手动执行 `node backend/server.js` 查看终端报错。默认启动脚本会结束占用所配置端口的进程，启动前确认该端口用于本平台。
- **更新代码后页面没变**：重新构建前端后重启服务：`npm --prefix frontend run build`。

## 4. 手动运行与检查（可选）

以下命令在项目根目录分别执行：

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix frontend run build
node backend/server.js
```

开发前端时另开终端执行 `npm --prefix frontend run dev`，默认地址为 `http://127.0.0.1:5173`，后端需同时运行。自定义后端端口时，还需同步 `frontend/vite.config.js` 的代理配置。

修改绘图、扫描或缓存逻辑后，可运行专项检查（使用临时数据）：

```powershell
node backend/scripts/verify-cache-compatibility.js
matlab -batch "addpath('backend/scripts'); verify_matlab_compatibility"
```
