function check_environment(outputDir)
% Only synthetic data in the caller's private directory; no user DEM/licence reads.
if ~isfolder(outputDir), mkdir(outputDir); end
oldVisibility = get(0, 'DefaultFigureVisible');
cleanup = onCleanup(@() restoreVisibility(oldVisibility)); %#ok<NASGU>
set(0, 'DefaultFigureVisible', 'off');
room = fullfile(outputDir, 'synthetic-demo', 'pred', 'indoor');
outside = fullfile(outputDir, 'synthetic-demo', 'pred', 'outdoor');
mkdir(room); mkdir(outside);
writeText(fullfile(room, 'index.txt'), sprintf('RSRP_1.dem 0 2 0 1 1\n'));
writeDem(fullfile(room, 'RSRP_1.dem'), [-10000 -9000 -8000 -32768]);
writeText(fullfile(outside, 'index.txt'), sprintf('UTM 49\nSCR.dem 0 2 0 2 1\n'));
writeDem(fullfile(outside, 'SCR.dem'), [-100 200 300 -32768]);
base = struct('preddir', room, 'taskName', 'indoor', 'dataType', 'RSRP', 'layer', 'F1', ...
    'layerLabel', 'F1', 'outFile', fullfile(outputDir, 'indoor.png'), 'indoor', true, ...
    'demFile', fullfile(room, 'RSRP_1.dem'), 'wallFile', '', ...
    'bounds', struct('left', 0, 'right', 2, 'bottom', 0, 'top', 1, 'res', 1), ...
    'xlim', [0 2], 'ylim', [0 1], 'coordMode', 'abs');
figures = [base base];
figures(2).preddir = outside; figures(2).taskName = 'outdoor'; figures(2).dataType = 'SCR';
figures(2).layer = ''; figures(2).layerLabel = 'ground'; figures(2).indoor = false;
figures(2).demFile = fullfile(outside, 'SCR.dem'); figures(2).outFile = fullfile(outputDir, 'outdoor.png');
figures(2).ylim = [0 2];
job = fullfile(outputDir, 'check-job.json'); writeText(job, jsonencode(struct('figures', figures)));
log = evalc('plot_dispatch(job)'); fprintf('%s', log);
assert(~contains(log, 'FIGURE_ERROR'), log); assert(contains(log, 'PROGRESS 2/2'), 'Synthetic render did not finish');
for i = 1:2
    info = imfinfo(figures(i).outFile);
    assert(info.Width > 100 && info.Height > 100, 'PNG dimensions invalid');
end
result = struct('schemaVersion', 1, 'matlabVersion', version, ...
    'checks', struct('indoor', true, 'outdoor', true, 'png', true));
writeText(fullfile(outputDir, 'check-result.json'), jsonencode(result));
fprintf('ANTENNA_ENVIRONMENT_OK\n');
end
function writeText(file, value)
fid = fopen(file, 'w', 'n', 'UTF-8'); assert(fid >= 0, 'Cannot write check file');
cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
fprintf(fid, '%s', value);
end
function writeDem(file, values)
fid = fopen(file, 'wb', 'ieee-le'); assert(fid >= 0, 'Cannot write synthetic DEM');
cleanup = onCleanup(@() fclose(fid)); %#ok<NASGU>
fwrite(fid, int16(values), 'int16');
end
function restoreVisibility(visibility)
close all; set(0, 'DefaultFigureVisible', visibility);
end
