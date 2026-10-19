function data = showrsrp_outdoor(preddir, dataType, layer)
% 内置室外渲染器，不依赖平台目录外的 showrsrp_* 脚本。
if nargin < 3, layer = ''; end
dataType = upper(char(dataType));
target = [dataType '.dem'];
indexFile = fullfile(preddir, 'index.txt');
fid = fopen(indexFile, 'rt');
if fid < 0, error('无法打开索引文件: %s', indexFile); end
cleanup = onCleanup(@() fclose(fid));
record = [];
dataName = target;
while true
    line = fgetl(fid);
    if ~ischar(line), break; end
    fields = regexp(strtrim(line), '\s+', 'split');
    if numel(fields) == 6 && strcmpi(fields{1}, target)
        record = str2double(fields(2:6));
        dataName = fields{1};
        break;
    end
end
clear cleanup;
if isempty(record) || any(~isfinite(record)) || record(5) <= 0 ...
        || record(2) <= record(1) || record(4) <= record(3)
    error('index.txt 中没有有效的 %s 范围', target);
end
left = record(1); right = record(2);
bottom = record(3); top = record(4); res = record(5);
N = ceil((right-left)/res);
M = ceil((top-bottom)/res);
demFile = fullfile(preddir, layer, dataName);
fid = fopen(demFile, 'rb', 'ieee-le');
if fid < 0, error('无法打开数据文件: %s', demFile); end
cleanup = onCleanup(@() fclose(fid));
raw = fread(fid, Inf, 'int16=>double');
clear cleanup;
if numel(raw) ~= M*N
    error('栅格大小不匹配: %s 预期 %d×%d=%d 个 int16，实际 %d 个', ...
        demFile, M, N, M*N, numel(raw));
end
data = flipud(reshape(raw, N, M)');
valid = data ~= -32768;
if ~strcmp(dataType, 'BESTSERVER'), data(valid) = data(valid)/100; end
data(~valid) = NaN;
switch dataType
    case 'RSRP', lims = [-120 -40]; label = 'RSRP (dBm)';
    case 'DLRSSINR', lims = [-10 30]; label = 'DL RSSINR (dB)';
    case 'SCR', lims = [-30 15]; label = 'SCR (dB)';
    case 'ECHORP', lims = [-180 -110]; label = 'Echo Received Power (dBm)';
    case 'BESTSERVER', lims = []; label = 'Best Server ID';
    otherwise, error('不支持的室外数据类型: %s', dataType);
end
figure('Color', 'w');
ax = axes;
im = imagesc(ax, left+(0:N-1)*res, bottom+(0:M-1)*res, data);
im.AlphaData = double(valid);
set(ax, 'YDir', 'normal', 'Color', 'w', 'FontName', 'Times New Roman', 'FontSize', 12);
if isempty(lims)
    values = data(valid);
    if isempty(values), lims = [0 1]; else, lims = [min(values) max(values)]; end
    if lims(1) == lims(2), lims = lims + [-0.5 0.5]; end
end
caxis(ax, lims);
if strcmp(dataType, 'BESTSERVER')
    colormap(ax, jet(256));
else
    colormap(ax, flipud(jet(256))); % 与原室外脚本的色表方向一致
end
hold(ax, 'on');
drawOutdoorOverlays(ax, preddir, [left right bottom top]);
axis(ax, 'equal');
xlim(ax, [left right]); ylim(ax, [bottom top]);
xlabel(ax, 'X (m)'); ylabel(ax, 'Y (m)');
box(ax, 'on');
c = colorbar(ax); c.Label.String = label;
end

function drawOutdoorOverlays(ax, preddir, bounds)
% 与原室外脚本一致,建筑与基站始终从 pred/0 读取。
buildingFile = fullfile(preddir, 'building1');
if isfile(buildingFile)
    fid = fopen(buildingFile, 'rt');
    if fid < 0, error('无法打开建筑文件: %s', buildingFile); end
    cleanup = onCleanup(@() fclose(fid));
    while ~feof(fid)
        digest = textscan(fid, '%d %s %d %f', 1);
        if isempty(digest{3}), break; end
        polygon = textscan(fid, '%f %f', digest{3});
        x = polygon{1}; y = polygon{2};
        if isempty(x) || isempty(y), continue; end
        if min(x) > bounds(2) || max(x) < bounds(1) || min(y) > bounds(4) || max(y) < bounds(3)
            continue;
        end
        plot(ax, x, y, 'Color', [0.5 0.5 0.5], 'LineWidth', 0.8);
        if digest{4} > 30
            text(ax, x(1), y(1), num2str(digest{4}), 'FontSize', 10, 'Color', [0.7 0.7 0.7]);
        end
    end
    clear cleanup;
end
cellFile = fullfile(preddir, 'cells1.txt');
if isfile(cellFile)
    fid = fopen(cellFile, 'rt');
    if fid < 0, error('无法打开基站文件: %s', cellFile); end
    cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
    cells = textscan(fid, '%s%f%f%f', 'Delimiter', ',');
    for k = 1:numel(cells{1})
        scatter(ax, cells{2}(k), cells{3}(k), 100/3, 'r', ...
            'MarkerEdgeColor', [0 .5 .5], 'MarkerFaceColor', [0 .7 .7], 'LineWidth', 1.5);
    end
end
end
