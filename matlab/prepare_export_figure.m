function prepare_export_figure(fig)
% Export only data graphics. Hover state must not leak axes UI into PNGs.
set(fig, 'ToolBar', 'none', 'MenuBar', 'none');
axesList = findall(fig, 'Type', 'axes');
for i = 1:numel(axesList)
    ax = axesList(i);
    if isprop(ax, 'Toolbar') && ~isempty(ax.Toolbar)
        ax.Toolbar.Visible = 'off';
    end
    disableDefaultInteractivity(ax);
end
drawnow;
end
