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
    titleText = sprintf('%s (%s) @ %s', dataType, meta.unit, layerText);
end
if ~isempty(srcName)
    titleText = sprintf('%s · %s', titleText, srcName);
end
title(gca, titleText, 'FontName', titleFont(), 'FontSize', 13, 'FontWeight', 'bold');

outDir = fileparts(outFile);
if ~isempty(outDir) && ~isfolder(outDir)
    mkdir(outDir);
end
exportgraphics(gcf, outFile, 'Resolution', 150);
close(gcf);
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
