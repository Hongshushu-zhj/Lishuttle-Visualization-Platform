const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config, JOBS_DIR, MATLAB_DIR, REPO_ROOT } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');

// 启动一次 MATLAB -batch 执行 job 中所有待画图。
// figures: 本次要画的 job figure 对象列表(与 job.json 顺序一致)
// stdout 协议(由 plot_dispatch.m 输出):
//   PROGRESS i/N          第 i 张成功
//   AXES i x1 x2 y1 y2    第 i 张图实际使用的坐标范围(核对统一范围用)
//   FIGURE_ERROR i 消息   第 i 张失败(继续画下一张)
//   DONE                  全部完成
function runMatlabJob(job, figures, onFigureDone, onFigureError, onFigureAxes) {
  return new Promise((resolve, reject) => {
    const jobDir = path.join(JOBS_DIR, job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const jobFile = path.join(jobDir, 'job.json');
    const taskFigures = figures.map((f) => ({
      preddir: f.preddir,
      dataType: f.dataType,
      layer: f.layer === GROUND_LAYER ? '' : f.layer,
      layerLabel: f.layerLabel || '',
      outFile: f.pngFile,
      // 室内:直接给出数据文件、墙线文件与范围(室内 index.txt 格式与室外不同)
      indoor: !!f.indoor,
      demFile: f.demFile,
      wallFile: f.wallsFile || '',
      bounds: f.bounds || null,
      // 统一坐标范围(同一批图一致)与坐标显示方式,由 plot_dispatch.m 应用
      xlim: f.xlim || null,
      ylim: f.ylim || null,
      coordMode: f.coordMode || 'abs',
    }));
    fs.writeFileSync(jobFile, JSON.stringify({ figures: taskFigures }));

    const code = `addpath('${MATLAB_DIR}'); plot_dispatch('${jobFile}');`;
    const cmd = `"${config.matlabExe}" -batch "${code}"`;
    const proc = spawn(cmd, { shell: true, windowsHide: true, cwd: REPO_ROOT });

    let stderr = '';
    let sawDone = false;
    let stdoutBuffer = ''; // stdout 按块到达,需缓存半行,否则长行会被截断漏解析
    proc.stdout.on('data', (d) => {
      stdoutBuffer += d.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop(); // 最后一段可能是半行,留到下次
      for (const line of lines) {
        const m = line.match(/^PROGRESS\s+(\d+)\/(\d+)/);
        if (m) {
          onFigureDone(Number(m[1]) - 1);
          continue;
        }
        const ax = line.match(/^AXES\s+(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
        if (ax && onFigureAxes) {
          const idx = Number(ax[1]) - 1;
          if (idx >= 0 && idx < figures.length) {
            onFigureAxes(idx, [Number(ax[2]), Number(ax[3]), Number(ax[4]), Number(ax[5])]);
          }
          continue;
        }
        const fe = line.match(/^FIGURE_ERROR\s+(\d+)\s+(.*)$/);
        if (fe) onFigureError(Number(fe[1]) - 1, fe[2]);
        if (/^DONE/.test(line.trim())) sawDone = true;
      }
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (exitCode) => {
      if (exitCode === 0 && sawDone) resolve();
      else reject(new Error((stderr || `MATLAB 进程异常退出(exit ${exitCode})`).slice(-2000)));
    });
  });
}

module.exports = { runMatlabJob };
