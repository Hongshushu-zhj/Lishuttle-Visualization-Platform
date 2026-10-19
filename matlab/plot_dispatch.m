function plot_dispatch(jobFile)
% plot_dispatch  批量绘图调度脚本(平台后端调用)
%
% 用法:
%   plot_dispatch('C:\...\job.json')
%
% job.json 格式:
%   { "figures": [ { "preddir": "...pred\0", "dataType": "RSRP",
%                    "layer": "10m" 或 ""(地面), "outFile": "...png" } ] }
%
% 说明:
%   - 使用本目录内的 showrsrp_* 渲染函数,出图风格与手动绘图一致;
%   - 每张图追加标题"数据类型 (单位) @ 高度层",标注直接写入 PNG;
%   - stdout 输出 PROGRESS i/N、FIGURE_ERROR i 消息、DONE,供后端解析进度。

job = jsondecode(fileread(jobFile));
if isfield(job, 'figures')
    figures = job.figures;
else
    figures = job;
end
if ~iscell(figures)
    if isstruct(figures)
        figures = num2cell(figures);
    else
        error('job.json 中 figures 字段格式不正确');
    end
end

scriptDir = fileparts(mfilename('fullpath'));
addpath(scriptDir); % 绘图脚本随平台一起分发,无需依赖上级目录

n = numel(figures);
for i = 1:n
    fig = figures{i};
    try
        renderOne(fig, i);
        fprintf('PROGRESS %d/%d\n', i, n);
    catch err
        msg = strrep(err.message, newline, ' ');
        fprintf('FIGURE_ERROR %d %s\n', i, msg);
        % 详细堆栈写到 stderr,便于后端把失败原因透传给前端排查
        fprintf(2, '--- 第 %d 张图失败详情 ---\n%s\n', i, getReport(err, 'extended', 'hyperlinks', 'off'));
        try
            close all;
        catch
        end
    end
end
fprintf('DONE\n');
end

% ------------------------------------------------------------------
function renderOne(fig, figIndex)
preddir = char(fig.preddir);
dataType = upper(char(fig.dataType));
layer = '';
if isfield(fig, 'layer') && ~isempty(fig.layer)
    layer = char(fig.layer);
end
layerLabel = '';
if isfield(fig, 'layerLabel') && ~isempty(fig.layerLabel)
    layerLabel = char(fig.layerLabel);
end
outFile = char(fig.outFile);

% 来源文件夹名(用于标题标注):.../<源名>/pred/0
[~, srcName] = fileparts(fileparts(fileparts(preddir)));

% 标题:数据类型 (单位) @ 高度层/楼层 · 来源文件夹
if isempty(layerLabel)
    if isempty(layer) || strcmpi(layer, 'ground')
        layerLabel = '地面';
    else
        layerLabel = layer;
    end
end
meta = typeMeta(dataType);
if isempty(meta.unit)
    titleText = sprintf('%s @ %s', dataType, layerLabel);
else
    titleText = sprintf('%s (%s) @ %s', dataType, meta.unit, layerLabel);
end
if ~isempty(srcName)
    titleText = sprintf('%s · %s', titleText, srcName);
end

if isfield(fig, 'indoor') && logical(fig.indoor)
    % ---- 室内:调用室内渲染器(局部坐标 + 墙线/建筑叠加),范围由后端给出 ----
    if ~exist('showrsrp_indoor', 'file')
        error('缺少室内绘图脚本 showrsrp_indoor.m');
    end
    bounds = [];
    if isfield(fig, 'bounds') && ~isempty(fig.bounds)
        bounds = struct('left', fig.bounds.left, 'right', fig.bounds.right, ...
            'bottom', fig.bounds.bottom, 'top', fig.bounds.top, 'res', fig.bounds.res);
    end
    wallFile = '';
    if isfield(fig, 'wallFile') && ~isempty(fig.wallFile)
        wallFile = char(fig.wallFile);
    end
    showrsrp_indoor(char(fig.demFile), bounds, wallFile, titleText);
else
    % ---- 室外:调用本目录内的 showrsrp_* 渲染函数 ----
    if isempty(meta.fn) || ~exist(meta.fn, 'file')
        error('数据类型 %s 暂无对应绘图脚本', dataType);
    end
    if isempty(layer)
        feval(meta.fn, preddir);
    else
        feval(meta.fn, preddir, layer);
    end
    if ~ishghandle(gcf)
        error('渲染函数未生成图形');
    end
    title(gca, titleText, 'FontName', titleFont(), 'FontSize', 13, 'FontWeight', 'bold');
end

if ~ishghandle(gcf)
    error('渲染函数未生成图形');
end

% ---- 坐标轴统一处理(室内/室外共用)----
ax = gca;

% 1) 统一坐标范围:同一批次的所有图使用同一范围,跨源对比时坐标轴严格一致
if isfield(fig, 'xlim') && ~isempty(fig.xlim) && numel(fig.xlim) == 2
    xlim(ax, [fig.xlim(1), fig.xlim(2)]);
end
if isfield(fig, 'ylim') && ~isempty(fig.ylim) && numel(fig.ylim) == 2
    ylim(ax, [fig.ylim(1), fig.ylim(2)]);
end

% 2) 等比例锁定:让图上 x/y 方向的比例与真实米数一致(否则图面量距会偏 ~8%)
daspect(ax, [1 1 1]);

% 3) 坐标显示方式:绝对 UTM(默认)或相对坐标
coordMode = 'abs';
if isfield(fig, 'coordMode') && ~isempty(fig.coordMode)
    coordMode = char(fig.coordMode);
end
if ~strcmp(coordMode, 'abs')
    isIndoor = isfield(fig, 'indoor') && logical(fig.indoor);
    applyRelativeTicks(ax, coordMode, isIndoor);
end

outDir = fileparts(outFile);
if ~isempty(outDir) && ~isfolder(outDir)
    mkdir(outDir);
end
% 输出本图实际使用的坐标范围,便于核对"同一批图是否统一范围"
curX = xlim(gca);  curY = ylim(gca);
fprintf('AXES %d %.6f %.6f %.6f %.6f\n', figIndex, curX(1), curX(2), curY(1), curY(2));
exportgraphics(gcf, outFile, 'Resolution', 150);
close(gcf);
end

% ------------------------------------------------------------------
function applyRelativeTicks(ax, mode, isIndoor)
% 把刻度标签改写成相对坐标(原点取区域左下角或中心),并在坐标轴标题里注明原点,
% 便于报告阅读;轴范围本身保持绝对值不变(不影响与 GIS/工参叠加的几何关系)。
% 注意:标签含中文,必须用支持中文的字体,否则会渲染成方框。
if nargin < 3
    isIndoor = false;
end
coordName = 'UTM';
if isIndoor
    coordName = '局部坐标';
end
xl = xlim(ax);  yl = ylim(ax);
switch mode
    case 'rel-ll'      % 相对左下角
        ox = xl(1);  oy = yl(1);
        originText = sprintf('原点=左下角 %s(%.0f, %.0f)', coordName, ox, oy);
    case 'rel-center'  % 相对中心
        ox = mean(xl);  oy = mean(yl);
        originText = sprintf('原点=中心 %s(%.0f, %.0f)', coordName, ox, oy);
    otherwise
        return;
end

stepX = niceStep(xl(2) - xl(1));
stepY = niceStep(yl(2) - yl(1));
set(ax, 'XTick', makeTicks(xl, ox, stepX), 'XTickLabel', tickLabels(xl, ox, stepX));
set(ax, 'YTick', makeTicks(yl, oy, stepY), 'YTickLabel', tickLabels(yl, oy, stepY));
fontName = titleFont();   % 支持中文的字体
xlabel(ax, sprintf('X 相对距离(m)  [%s]', originText), 'FontName', fontName, 'FontSize', 12);
ylabel(ax, 'Y 相对距离(m)', 'FontName', fontName, 'FontSize', 12);
end

% 取"整"的刻度间隔(1/2/2.5/5 × 10^n 中最接近 目标间隔 的值)
function step = niceStep(span)
raw = span / 7;
p = 10 ^ floor(log10(raw));
candidates = [1 2 2.5 5 10] * p;
[~, idx] = min(abs(candidates - raw));
step = candidates(idx);
end

function ticks = makeTicks(limits, origin, step)
first = ceil((limits(1) - origin) / step);
last = floor((limits(2) - origin) / step);
ticks = origin + (first:last) * step;
end

function labels = tickLabels(limits, origin, step)
ticks = makeTicks(limits, origin, step);
labels = arrayfun(@(v) formatTick(v - origin), ticks, 'UniformOutput', false);
end

function s = formatTick(v)
if abs(v) >= 100
    s = sprintf('%.0f', v);
elseif abs(v) >= 10
    s = sprintf('%.0f', v);
else
    s = sprintf('%.3g', v);
end
end

% ------------------------------------------------------------------
function name = titleFont()
% 标题含中文(如"地面"),需使用支持中文的字体,否则渲染为方框
candidates = {'Microsoft YaHei', 'SimHei', 'SimSun'};
installed = listfonts();
for i = 1:numel(candidates)
    if any(strcmpi(installed, candidates{i}))
        name = candidates{i};
        return;
    end
end
name = 'Helvetica';
end

% ------------------------------------------------------------------
function meta = typeMeta(dataType)
switch dataType
    case 'RSRP'
        meta = struct('fn', 'showrsrp_rsrp', 'unit', 'dBm');
    case 'SCR'
        meta = struct('fn', 'showrsrp_scr', 'unit', 'dB');
    case 'ECHORP'
        meta = struct('fn', 'showrsrp_echorp', 'unit', 'dBm');
    case 'DLRSSINR'
        meta = struct('fn', 'showrsrp_dlrssinr', 'unit', 'dB');
    case 'BESTSERVER'
        meta = struct('fn', 'showrsrp_bestserver', 'unit', '');
    otherwise
        meta = struct('fn', '', 'unit', '');
end
end
