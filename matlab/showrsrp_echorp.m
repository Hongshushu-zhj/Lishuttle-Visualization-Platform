function echorp = showrsrp_echorp(preddir, varargin)
subFolder = [];
if nargin > 1
    subFolder = varargin{1};
end

zoom = 1;
figure(); %clf;
hold on;
echorpLims = [-180 -110];%显示数值范围(Echo RP典型范围)
indexfile = sprintf('%s\\\\index.txt',preddir);
[predfiles,left,right,bottom,top,res] = textread(indexfile, '%s %f %f %f %f %f');
index = find(~cellfun('isempty', regexp(predfiles, 'ECHORP.dem')));%查找ECHORP.dem
if isempty(index)
    return;
end

if isempty(subFolder)
    covfile = sprintf('%s\\\\%s',preddir, predfiles{index(1)});
else
    covfile = sprintf('%s\\\\%s\\\\%s',preddir, subFolder, predfiles{index(1)});
end
right = right(index(1));
top = top(index(1));
left = left(index(1));
bottom = bottom(index(1));
res = res(index(1));
xmin = left;
xmax = right;
ymin = bottom;
ymax = top;
M1=ceil((top-bottom)/res);
N1=ceil((right - left)/res);
M = ceil(M1/zoom);
N = ceil(N1/zoom);
fid = fopen(covfile,'rb');
echorp = zeros(M, N);
row = 0;
while feof(fid) == 0
    [row_array,ele_count]=fread(fid,N1,'int16');
    row = row + 1;
    if ele_count<N
        break;
    else
        echorp(row,:)=row_array(1:zoom:N1)';
    end
    if (zoom > 1)
        for i=1:(zoom-1)
            if (feof(fid) == 0)
                fread(fid,N1,'int16');
            end
        end
    end
end
fclose(fid);
echorp = flipud(echorp);
alphadata = ones(M,N) * 1;
filter = (echorp==-32768);
alphadata(filter) = 0;
echorp(~filter) = echorp(~filter) /100;
%偏移值
K=0;
echorp(~filter) = echorp(~filter) + K;
%画覆盖图
X = left:(res*zoom):right-0.01;
Y = bottom:(res*zoom):top-0.01;
cmap = flipud(colormap(jet)); %colormap(jet)
colormap(cmap);
im = imagesc(X,Y,echorp,echorpLims);
im.AlphaData = alphadata;
%画建筑
buildingfile = sprintf('%s\\\\building1', preddir);
if isfile(buildingfile)
    fid = fopen(buildingfile);
    while feof(fid) == 0
        digest = textscan(fid, '%d %s %d %f', 1);
        if (size(digest{3},1)==0)
            break;
        end
        polygon = textscan(fid, '%f %f', digest{3});
        if min(polygon{1}) > xmax
            continue;
        elseif max(polygon{1}) < xmin
            continue;
        end
        if min(polygon{2}) > ymax
            continue;
        elseif max(polygon{2}) < ymin
            continue;
        end
        plot(polygon{1},polygon{2},'Color',[0.5 0.5 0.5],'LineWidth',0.8);
        if (digest{4} > 30)
            str = num2str(digest{4});
            text(polygon{1}(1), polygon{2}(1), str, 'FontSize', 10, 'Color', [0.7 0.7 0.7]);
        end
    end
    fclose(fid);
end
%画基站
r = 100;
cellfile = sprintf('%s\\\\cells1.txt', preddir);
if isfile(cellfile)
    fid = fopen(cellfile);
    cells = textscan(fid, "%s%f%f%f", 'Delimiter',',');
    rows = length(cells{1});
    for i = 1:rows
        angle = (90 - cells{1,4}(i)) * pi / 180;
        x = [cells{1,2}(i), cells{1,2}(i) + r * cos(angle)];
        y = [cells{1,3}(i), cells{1,3}(i) + r * sin(angle)];
        scatter(x(1), y(1), r/3, 'r', 'MarkerEdgeColor', [0 .5 .5], 'MarkerFaceColor', [0 .7 .7], 'LineWidth', 1.5);
        if x(1) < xmin
            xmin = x(1);
        elseif x(1) > xmax
            xmax = x(1);
        end
        if y(1) < ymin
            ymin = y(1);
        elseif y(1) > ymax
            ymax = y(1);
        end
    end
    fclose(fid);
end
colorbar;
set(gcf,'color','w');
fs = 12;
c = colorbar;
c.Label.String = 'Echo Received Power (dBm)';
set(c,'fontsize',fs);
set(gca,'fontname', 'times new roman','fontsize',fs);
xlabel('X(m)','fontname', 'times new roman','fontSize',fs);
ylabel('Y(m)','fontname', 'times new roman','fontSize',fs);
xlim([xmin, xmax]);
ylim([ymin, ymax]);
box on;
end
