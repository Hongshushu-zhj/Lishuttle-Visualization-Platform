function verify_export_safety(outputDir)
if ~isfolder(outputDir), mkdir(outputDir); end
f = figure('Visible', 'off'); cleanup = onCleanup(@() close(f)); %#ok<NASGU>
ax = axes(f); imagesc(ax, [1 2;3 4]); axis(ax,'equal'); title(ax,'SCR export'); colorbar(ax);
tb = axtoolbar(ax, 'default'); tb.Visible = 'on';
x = xlim(ax); y = ylim(ax); c = caxis(ax); pixels = findobj(ax,'Type','Image'); before = pixels.CData;
prepare_export_figure(f);
assert(strcmp(tb.Visible,'off'),'Axes toolbar remains visible');
assert(strcmp(f.ToolBar,'none') && strcmp(f.MenuBar,'none'),'Figure chrome remains visible');
assert(isequal(x,xlim(ax)) && isequal(y,ylim(ax)) && isequal(c,caxis(ax)) && isequal(before,pixels.CData),'Export preparation changed numeric semantics');
exportgraphics(f,fullfile(outputDir,'toolbar-regression.png'),'Resolution',150);
fprintf('EXPORT_SAFETY_OK\n');
end
