function showrsrp_indoor(demFile, varargin)
% showrsrp_indoor  室内覆盖/路损绘图:栅格数据 + 墙线(建筑)叠加
%
% 用法:
%   showrsrp_indoor('D:\...\pred\0\RSRP_1.dem')                 % 自动找同目录 index.txt 与墙线文件
%   showrsrp_indoor(demFile, bounds)                            % 显式给出范围
%   showrsrp_indoor(demFile, bounds, wallFile, titleText)       % 平台调用形式
%
% bounds: struct('left',..,'right',..,'bottom',..,'top',..,'res',..)
%   index.txt 有两种室内写法:仅 5 个数(左 右 下 上 分辨率),或 "文件名 左 右 下 上 分辨率";
%   栅格规模按室内约定 N = floor((right-left)/res),M = floor((top-bottom)/res)+1,
%   并用文件字节数做校验,自动纠正取整误差(避免栅格错位导致的斜切图)。
%
% 与室外脚本的差异:
%   1) 坐标为局部米制(非 UTM),范围小;
%   2) 必须叠加墙线/建筑(室内遮挡的主要来源);
%   3) 不透明度默认 1(无效值透明),数据密度更高。

demFile = char(demFile);
bounds = [];
wallFile = '';
titleText = '';
if numel(varargin) >= 1 && ~isempty(varargin{1})
    bounds = varargin{1};
end
if numel(varargin) >= 2 && ~isempty(varargin{2})
    wallFile = char(varargin{2});
end
if numel(varargin) >= 3 && ~isempty(varargin{3})
    titleText = char(varargin{3});
end

if isempty(bounds)
    bounds = readIndoorBounds(demFile);
end
if isempty(wallFile)
    wallFile = findWallFile(demFile);
end

[left, right, bottom, top, res] = deal(bounds.left, bounds.right, bounds.bottom, bounds.top, bounds.res);
[N1, M1] = indoorGridSize(demFile, left, right, bottom, top, res);

% ---- 读取栅格 ----
fid = fopen(demFile, 'rb');
if fid < 0
    error('无法打开数据文件: %s', demFile);
end
data = zeros(M1, N1);
row = 0;
while ~feof(fid)
    [rowArray, eleCount] = fread(fid, N1, 'int16');
    row = row + 1;
    if eleCount < N1
        break;
    end
    data(row, :) = rowArray';
end
fclose(fid);
data = data(1:min(row, M1), :);

data = flipud(data);                       % 与室外一致:翻转为 Y 轴向上
invalid = (data == -32768);
[~, dataName] = fileparts(demFile);
isBestServer = startsWith(upper(dataName), 'BESTSERVER');
if ~isBestServer
    data(~invalid) = data(~invalid) / 100; % 功率/信噪比放大 100 倍,小区编号保持整数
end
alphadata = ones(size(data));
alphadata(invalid) = 0;                    % 无数据处透明

% ---- 显示范围(各类型默认值,可按需调整) ----
lims = indoorColorLims(demFile);
if isBestServer
    valid = data(~invalid);
    if isempty(valid)
        lims = [0 1];
    else
        lims = [min(valid) max(valid)];
        if lims(1) == lims(2), lims = lims + [-0.5 0.5]; end
    end
end

% ---- 绘图 ----
figure();
hold on;
X = left:res:right - 0.01;
Y = bottom:res:top - 0.01;
if numel(X) > N1, X = X(1:N1); end
if numel(Y) > size(data, 1), Y = Y(1:size(data, 1)); end
im = imagesc(X, Y, data, lims);
im.AlphaData = alphadata;
if isBestServer, colormap(jet); else, colormap(flipud(jet)); end
set(gca, 'YDir', 'normal');

% ---- 叠加墙线(建筑) ----
wallCount = 0;
if ~isempty(wallFile) && isfile(wallFile)
    walls = readWallSegments(wallFile);
    if ~isempty(walls) && size(walls, 2) >= 4
        for row = 1:size(walls, 1)
            x = walls(row, [1 3]);
            y = walls(row, [2 4]);
            % 完全落在范围外的墙线段跳过,减少绘制量
            if max(x) < left || min(x) > right || max(y) < bottom || min(y) > top
                continue;
            end
            plot(x, y, 'Color', [0.15 0.15 0.15], 'LineWidth', 0.8);
            wallCount = wallCount + 1;
        end
    end
end

% ---- 坐标轴与标注 ----
colorbar;
set(gcf, 'color', 'w');
fs = 12;
c = colorbar;
c.Label.String = colorbarLabel(demFile);
set(c, 'fontsize', fs);
set(gca, 'fontname', 'times new roman', 'fontsize', fs);
xlabel('X(m)', 'fontname', 'times new roman', 'fontSize', fs);
ylabel('Y(m)', 'fontname', 'times new roman', 'fontSize', fs);
xlim([left, right]);
ylim([bottom, top]);
box on;

if ~isempty(titleText)
    title(gca, titleText, 'FontName', 'Microsoft YaHei', 'FontSize', 13, 'FontWeight', 'bold');
end
if wallCount == 0
    % 没有墙线时给出提示(室内图缺建筑会明显影响判读)
    warning('未找到或未绘制任何墙线数据(室内图建议叠加建筑轮廓)');
end
end

% ------------------------------------------------------------------
function walls = readWallSegments(wallFile)
% 支持纯四列墙线，以及 building.txt 的“块编号 数量”+“编号 x1 y1 x2 y2”。
% building 文件后续 intersections / boundary 段不属于墙线。
fid = fopen(wallFile, 'rt');
if fid < 0
    error('无法打开墙线文件: %s', wallFile);
end
cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
lines = {};
while true
    line = fgetl(fid);
    if ~ischar(line), break; end
    line = strtrim(regexprep(line, '%.*$', '')); % 兼容 load 支持的注释行和行尾注释
    if ~isempty(line), lines{end + 1} = line; end %#ok<AGROW>
end
walls = zeros(0, 4);
if isempty(lines), return; end
header = str2double(regexp(lines{1}, '[\s,]+', 'split'));
if numel(header) == 2 && all(isfinite(header)) && header(2) >= 0 && header(2) == fix(header(2))
    count = header(2);
    if numel(lines) < count + 1
        error('墙线文件声明 %d 条墙线，实际记录不足: %s', count, wallFile);
    end
    walls = zeros(count, 4);
    for k = 1:count
        values = str2double(regexp(lines{k + 1}, '[\s,]+', 'split'));
        if numel(values) ~= 5 || any(~isfinite(values))
            error('墙线记录 %d 应为“编号 x1 y1 x2 y2”: %s', k, wallFile);
        end
        walls(k, :) = values(2:5);
    end
else
    walls = zeros(numel(lines), 4);
    for k = 1:numel(lines)
        values = str2double(regexp(lines{k}, '[\s,]+', 'split'));
        if numel(values) ~= 4 || any(~isfinite(values))
            error('墙线记录 %d 应为“x1 y1 x2 y2”: %s', k, wallFile);
        end
        walls(k, :) = values;
    end
end
end

% ------------------------------------------------------------------
function [N1, M1] = indoorGridSize(demFile, left, right, bottom, top, res)
% 室内约定:先按 floor 计算,再用文件字节数校正(浮点取整会差 1)
N1 = floor((right - left) / res);
M1 = floor((top - bottom) / res) + 1;
st = dir(demFile);
if isempty(st)
    return;
end
total = st.bytes / 2;   % int16 个数
cands = [];
for dn = -1:1
    for dm = -1:1
        n = N1 + dn;
        m = M1 + dm;
        if n > 0 && m > 0 && n * m == total
            cands = [cands; n, m]; %#ok<AGROW>
        end
    end
end
if ~isempty(cands)
    % 取与理论值最接近的候选
    [~, idx] = min(abs(cands(:, 1) - N1) + abs(cands(:, 2) - M1));
    N1 = cands(idx, 1);
    M1 = cands(idx, 2);
end
end

function bounds = readIndoorBounds(demFile)
% 从同目录 index.txt 读取范围:支持 5 列(无文件名)与 6 列(文件名+5 列)两种写法
dirPath = fileparts(demFile);
indexFile = fullfile(dirPath, 'index.txt');
if ~isfile(indexFile)
    error('未找到 %s,请显式给出 bounds 参数', indexFile);
end
[~, baseName, ext] = fileparts(demFile);
target = [baseName ext];
fid = fopen(indexFile, 'r');
bounds = [];
while ~feof(fid)
    line = strtrim(fgetl(fid));
    if isempty(line) || ~ischar(line)
        continue;
    end
    parts = regexp(line, '[\s,]+', 'split');
    parts = parts(~cellfun(@isempty, parts));
    if numel(parts) == 5
        v = str2double(parts);
        if all(~isnan(v))
            bounds = struct('left', v(1), 'right', v(2), 'bottom', v(3), 'top', v(4), 'res', v(5));
            break;
        end
    elseif numel(parts) >= 6
        v = str2double(parts(2:6));
        if all(~isnan(v)) && strcmpi(parts{1}, target)
            bounds = struct('left', v(1), 'right', v(2), 'bottom', v(3), 'top', v(4), 'res', v(5));
            break;
        end
    end
end
fclose(fid);
if isempty(bounds)
    error('index.txt 中未找到 %s 对应的范围', target);
end
end

function wallFile = findWallFile(demFile)
% 墙线文件:优先同目录,其次上层目录;常见命名 walls/wall/floor/out.txt
dirPath = fileparts(demFile);
parentDir = fileparts(dirPath);
wallFile = '';
for d = {dirPath, parentDir}
    dirNow = d{1};
    if ~isfolder(dirNow)
        continue;
    end
    for cand = {'walls.txt', 'wall.txt', 'building.txt'}
        p = fullfile(dirNow, cand{1});
        if isfile(p)
            wallFile = p;
            return;
        end
    end
    items = dir(fullfile(dirNow, '*.txt'));
    for k = 1:numel(items)
        nm = lower(items(k).name);
        if contains(nm, 'floor') || contains(nm, 'wall') || strcmp(nm, 'out.txt')
            wallFile = fullfile(dirNow, items(k).name);
            return;
        end
    end
end
end

function lims = indoorColorLims(demFile)
% 各数据类型的室内显示范围(与室外脚本保持同一套口径,便于对比)
[~, name] = fileparts(demFile);
name = upper(name);
if contains(name, 'DLRSSINR')
    lims = [-10 30];
elseif contains(name, 'SCR')
    lims = [-30 15];
elseif contains(name, 'ECHORP')
    lims = [-180 -110];
elseif contains(name, 'BESTSERVER')
    lims = [0 1];
else
    lims = [-110 -40];   % RSRP 及默认
end
end

function s = colorbarLabel(demFile)
[~, name] = fileparts(demFile);
name = upper(name);
if contains(name, 'DLRSSINR')
    s = 'DL RSSINR(dB)';
elseif contains(name, 'SCR')
    s = 'SCR(dB)';
elseif contains(name, 'ECHORP')
    s = 'Echo Received Power(dBm)';
elseif contains(name, 'BESTSERVER')
    s = 'Best Server ID';
else
    s = 'Reference Signal Receving Power(dBm)';
end
end
