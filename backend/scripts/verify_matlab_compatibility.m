function verify_matlab_compatibility()
% 回归验证: matlab -batch "addpath('backend/scripts'); verify_matlab_compatibility"
root = fileparts(fileparts(fileparts(mfilename('fullpath'))));
scriptDir = fullfile(root, 'matlab');
originalPath = path;
originalVisibility = get(0, 'DefaultFigureVisible');
fixture = tempname;
mkdir(fixture);
cleanup = onCleanup(@() finish(fixture, originalPath, originalVisibility)); %#ok<NASGU>
addpath(scriptDir);
set(0, 'DefaultFigureVisible', 'off');
pred = fullfile(fixture, 'case', 'pred', '0'); mkdir(pred); mkdir(fullfile(pred, '10m'));
writeText(fullfile(pred, 'index.txt'), sprintf('UTM 49\nSCR.dem 0 2 0 2 1\n'));
writeDem(fullfile(pred, 'SCR.dem'), [-100 200 300 -32768]);
writeDem(fullfile(pred, '10m', 'SCR.dem'), [-100 200 300 -32768]);
writeText(fullfile(pred, 'building1'), sprintf('1 house 4 40\n0 0\n1 0\n1 1\n0 0\n'));
writeText(fullfile(pred, 'cells1.txt'), sprintf('cell,1,1,90\n'));
showrsrp_outdoor(pred, 'SCR', '10m');
ax = gca; im = findobj(ax, 'Type', 'image');
assert(isequaln(im.CData, [3 NaN; -1 2]));
assert(isequal(im.AlphaData, [1 0; 1 1]));
assert(isequal(colormap(ax), flipud(jet(256))));
assert(numel(findobj(ax, 'Type', 'line')) == 1);
assert(numel(findobj(ax, 'Type', 'scatter')) == 1);
assert(isequal(caxis(ax), [-30 15])); close all;

bounds = struct('left',0,'right',2,'bottom',0,'top',1,'res',1);
dem = fullfile(fixture, 'BESTSERVER_1.dem'); writeDem(dem, [101 102 103 -32768]);
wall = fullfile(fixture, 'walls.txt');
writeText(wall, sprintf('%% comment\n0 0 1 1 %% inline comment\n\n'));
showrsrp_indoor(dem, bounds, wall);
im = findobj(gca, 'Type', 'image');
assert(isequal(im.CData, [103 -32768;101 102]));
assert(isequal(caxis, [101 103]));
assert(numel(findobj(gca, 'Type', 'line')) == 1); close all;
writeDem(dem, [101 101 101 -32768]);
showrsrp_indoor(dem, bounds, wall); assert(isequal(caxis, [100.5 101.5])); close all;
writeDem(dem, [-32768 -32768 -32768 -32768]);
showrsrp_indoor(dem, bounds, wall); assert(isequal(caxis, [0 1])); close all;
writeText(wall, sprintf('1 2\n1 0 0 1 1\n2 0 1 1 0\nintersections\nignored\n'));
showrsrp_indoor(dem, bounds, wall);
assert(numel(findobj(gca, 'Type', 'line')) == 2); close all;
% 数据类型按文件名识别,父目录名称不能覆盖类型。
misleadingDir = fullfile(fixture, 'SCR-results'); mkdir(misleadingDir);
rsrp = fullfile(misleadingDir, 'RSRP_1.dem'); writeDem(rsrp, [-8000 -9000 -10000 -32768]);
showrsrp_indoor(rsrp, bounds, wall); assert(isequal(caxis, [-110 -40])); close all;

% 隔离五个旧脚本,实际覆盖备用调用路径与调度导出。
isolated = fullfile(fixture, 'isolated'); mkdir(isolated);
copyfile(fullfile(scriptDir, 'plot_dispatch.m'), isolated);
copyfile(fullfile(scriptDir, 'showrsrp_outdoor.m'), isolated);
rmpath(scriptDir); addpath(isolated); clear plot_dispatch;
fig = struct('preddir',pred,'dataType','SCR','layer','10m', ...
    'outFile',fullfile(fixture,'fallback.png'),'coordMode','rel-center', ...
    'xlim',[-1 3],'ylim',[-1 3]);
job = fullfile(fixture, 'job.json'); writeText(job,jsonencode(struct('figures',fig)));
log = evalc('plot_dispatch(job)');
assert(~contains(log, 'FIGURE_ERROR'), log);
assert(contains(log, 'PROGRESS 1/1'));
assert(contains(log, 'AXES 1 -1.000000 3.000000 -1.000000 3.000000'));
assert(isfile(fig.outFile));
fprintf('MATLAB_COMPATIBILITY_OK\n');
end

function writeText(file, text)
fid = fopen(file, 'w'); cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
fwrite(fid, text, 'char');
end
function writeDem(file, values)
fid = fopen(file, 'wb', 'ieee-le'); cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
fwrite(fid, int16(values), 'int16');
end
function finish(fixture, originalPath, visibility)
close all; path(originalPath); set(0, 'DefaultFigureVisible', visibility);
clear plot_dispatch;
rmdir(fixture, 's');
end
