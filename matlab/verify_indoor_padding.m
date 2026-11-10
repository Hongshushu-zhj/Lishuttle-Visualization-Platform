function verify_indoor_padding(outputDir)
% Synthetic actual-dispatch regression. Artifacts retained for visual review.
if nargin < 1, outputDir = tempname; end
mkdir(outputDir);
pred = fullfile(outputDir, 'synthetic', 'pred', '0'); mkdir(pred);
b = struct('left',20,'right',100,'bottom',-70,'top',0,'res',1);
dem = fullfile(pred, 'RSRP_1.dem');
fid = fopen(dem,'wb'); fwrite(fid, -9000 * ones(80,71), 'int16'); fclose(fid);
fid = fopen(fullfile(pred,'index.txt'),'w'); fprintf(fid,'RSRP.dem 20 100 -70 0 1\n'); fclose(fid);
copyfile(dem, fullfile(pred,'RSRP.dem'));
wall = fullfile(pred,'walls.txt');
fid = fopen(wall,'w'); fprintf(fid,'20 -70 100 -70\n100 -70 100 0\n100 0 20 0\n20 0 20 -70\n'); fclose(fid);
oldVisible = get(groot,'DefaultFigureVisible');
oldCreate = get(groot,'DefaultFigureCreateFcn');
cleanup = onCleanup(@() restoreDefaults(oldVisible,oldCreate)); %#ok<NASGU>
set(groot,'DefaultFigureVisible','off','DefaultFigureCreateFcn',@(f,~) set(f,'DeleteFcn',@captureFigure));
% Capture original image geometry/CData through the unchanged indoor renderer.
showrsrp_indoor(dem,b,wall,'baseline'); close(gcf);
baseline = getappdata(groot,'indoorPaddingCapture');
assert(~isempty(baseline.image));
modes = {'abs','rel-ll','rel-center','rel-ll','abs'};
for i = 1:numel(modes)
    fig = struct('preddir',pred,'dataType','RSRP','layer','','outFile',fullfile(outputDir,sprintf('case-%d.png',i)), ...
        'indoor',true,'demFile',dem,'wallFile',wall,'bounds',b,'xlim',[16 104],'ylim',[-74 4], ...
        'coordMode',modes{i},'coordBounds',struct('left',20,'right',100,'bottom',-70,'top',0));
    expected = [16 104 -74 4];
    if i == 4 % historical task: no coordBounds, original limits
        fig = rmfield(fig,'coordBounds'); fig.xlim = [20 100]; fig.ylim = [-70 0]; expected = [20 100 -70 0];
    elseif i == 5 % outdoor control retains original axes and cache-independent renderer
        fig.indoor = false; fig.xlim = [20 100]; fig.ylim = [-70 0]; expected = [20 100 -70 0];
        fid = fopen(fullfile(pred,'RSRP.dem'),'wb'); fwrite(fid,-9000*ones(80,70),'int16'); fclose(fid);
    end
    job = fullfile(outputDir,sprintf('job-%d.json',i));
    fid = fopen(job,'w'); fwrite(fid,jsonencode(struct('figures',fig)),'char'); fclose(fid);
    log = evalc('plot_dispatch(job)');
    fid = fopen(fullfile(outputDir,sprintf('case-%d.log',i)),'w'); fprintf(fid,'%s',log); fclose(fid);
    assert(~contains(log,'FIGURE_ERROR'),log);
    assert(contains(log,sprintf('AXES 1 %.6f %.6f %.6f %.6f',expected)),log);
    actual = getappdata(groot,'indoorPaddingCapture');
    assert(isequal(actual.limits,expected)); assert(isequal(actual.aspect,[1 1 1]));
    if i <= 4, assert(isequal(actual.image,baseline.image),'Raster data or positioning changed'); end
    if strcmp(modes{i},'rel-ll'), origin = [20 -70];
    elseif strcmp(modes{i},'rel-center'), origin = [60 -35];
    else, origin = []; end
    if ~isempty(origin)
        assert(contains(actual.xlabel,sprintf('(%.0f, %.0f)',origin)));
        assert(max(abs(str2double(actual.xlabels(:)) - (actual.xticks(:)-origin(1)))) < .01);
        assert(max(abs(str2double(actual.ylabels(:)) - (actual.yticks(:)-origin(2)))) < .01);
    end
    pixels = imread(fig.outFile); assert(size(pixels,1)>100 && size(pixels,2)>100);
end
fprintf('PASS indoor padding MATLAB: limits, actual ticks, raster geometry, equal aspect, PNG decode, legacy and outdoor\nArtifacts: %s\n',outputDir);
end

function captureFigure(fig,~)
ax = findall(fig,'Type','axes'); if isempty(ax), return; end; ax = ax(1);
im = findall(ax,'Type','image'); image = [];
if ~isempty(im), image = struct('XData',im(1).XData,'YData',im(1).YData,'CData',im(1).CData,'AlphaData',im(1).AlphaData); end
data = struct('limits',[xlim(ax) ylim(ax)],'aspect',daspect(ax),'image',image, ...
    'xlabel',ax.XLabel.String,'xticks',ax.XTick,'yticks',ax.YTick,'xlabels',{ax.XTickLabel},'ylabels',{ax.YTickLabel});
setappdata(groot,'indoorPaddingCapture',data);
end
function restoreDefaults(visible,create)
set(groot,'DefaultFigureVisible',visible,'DefaultFigureCreateFcn',create);
if isappdata(groot,'indoorPaddingCapture'), rmappdata(groot,'indoorPaddingCapture'); end
end
