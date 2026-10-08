% 测量导出 PNG 中绘图框的真实像素尺寸(打印所有长直线位置,便于识别色标干扰)
function png_frame_probe(files)
if nargin < 1
    files = {
      'D:\workspace\antenna-draw\platform\backend\data\cache\9b9e4940d862\SCR\ground.png'
      'D:\workspace\antenna-draw\platform\backend\data\cache\9b9e4940d862\SCR\ground@rel-center.png'
      };
end
xspan = 743866-742331; yspan = 2562085-2560620; target = xspan/yspan;
for i = 1:numel(files)
    f = files{i};
    if ~isfile(f), fprintf('(缺失) %s\n', f); continue; end
    I = imread(f); G = rgb2gray(I); [H,W] = size(G);
    colDark = mean(G < 120, 1);   % 每列暗像素占比
    rowDark = mean(G < 120, 2);   % 每行暗像素占比
    vcols = find(colDark > 0.5);
    hrows = find(rowDark > 0.5);
    fprintf('\n%s\n  图像 %dx%d\n  长竖线列位置: %s\n  长横线行位置: %s\n', ...
        f(max(1,end-46):end), W, H, mat2str(vcols), mat2str(hrows));
    fprintf('  等比例时绘图框宽高比应为 %.3f\n', target);
end
end
