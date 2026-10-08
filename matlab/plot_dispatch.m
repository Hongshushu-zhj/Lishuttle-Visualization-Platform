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
%   - 复用仓库根目录下已有的 showrsrp_* 渲染函数,出图风格与手动绘图一致;
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
repoRoot = fileparts(fileparts(scriptDir)); % platform/matlab -> platform -> 仓库根目录
addpath(repoRoot);

n = numel(figures);
for i = 1:n
    fig = figures{i};
    try
        renderOne(fig);
        fprintf('PROGRESS %d/%d\n', i, n);
    catch err
        msg = strrep(err.message, newline, ' ');
        fprintf('FIGURE_ERROR %d %s\n', i, msg);
        try
            close all;
        catch
        end
    end
end
fprintf('DONE\n');
end

% ------------------------------------------------------------------
function renderOne(fig)
preddir = char(fig.preddir);
dataType = upper(char(fig.dataType));
layer = '';
if isfield(fig, 'layer') && ~isempty(fig.layer)
    layer = char(fig.layer);
end
outFile = char(fig.outFile);

meta = typeMeta(dataType);
if isempty(meta.fn) || ~exist(meta.fn, 'file')
    error('数据类型 %s 暂无对应绘图脚本', dataType);
end

% 调用现有渲染函数:layer 为空表示地面层(preddir 根目录)
if isempty(layer)
    feval(meta.fn, preddir);
else
    feval(meta.fn, preddir, layer);
end

if ~ishghandle(gcf)
    error('渲染函数未生成图形');
end

% 标题标注:数据类型 (单位) @ 高度层 · 来源文件夹
if isempty(layer)
    layerText = '地面';
else
    layerText = layer;
end
[~, srcName] = fileparts(fileparts(fileparts(preddir))); % .../<源名>/pred/0
if isempty(meta.unit)
    titleText = sprintf('%s @ %s', dataType, layerText);
else
    titleText = sprintf('%s (%s) @ %s', dataType, layerText);
end
if ~isempty(srcName)
    titleText = sprintf('%s · %s', titleText, srcName);
end
title(gca, titleText, 'FontName', titleFont(), 'FontSize', 13, 'FontWeight', 'bold');

% ---- 坐标轴统一处理 ----
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
    applyRelativeTicks(ax, coordMode);
end

outDir = fileparts(outFile);
if ~isempty(outDir) && ~isfolder(outDir)
    mkdir(outDir);
end
exportgraphics(gcf, outFile, 'Resolution', 150);
close(gcf);
end

% ------------------------------------------------------------------
function applyRelativeTicks(ax, mode)
% 把刻度标签改写成相对坐标(原点取区域左下角或中心),并在坐标轴标题里注明原点,
% 便于报告阅读;轴范围本身保持绝对 UTM 不变(不影响与 GIS/工参叠加的几何关系)。
xl = xlim(ax);  yl = ylim(ax);
switch mode
    case 'rel-ll'      % 相对左下角
        ox = xl(1);  oy = yl(1);
        originText = sprintf('原点 = 区域左下角 UTM(%.0f, %.0f)', ox, oy);
    case 'rel-center'  % 相对中心
        ox = mean(xl);  oy = mean(yl);
        originText = sprintf('原点 = 区域中心 UTM(%.0f, %.0f)', ox, oy);
    otherwise
        return;
end

stepX = niceStep(xl(2) - xl(1));
stepY = niceStep(yl(2) - yl(1));
set(ax, 'XTick', makeTicks(xl, ox, stepX), 'XTickLabel', tickLabels(xl, ox, stepX));
set(ax, 'YTick', makeTicks(yl, oy, stepY), 'YTickLabel', tickLabels(yl, oy, stepY));
xlabel(ax, sprintf('X 相对距离(m)  [%s]', originText), 'FontName', 'times new roman', 'FontSize', 12);
ylabel(ax, 'Y 相对距离(m)', 'FontName', 'times new roman', 'FontSize', 12);
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
