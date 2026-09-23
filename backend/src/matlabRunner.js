const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config, JOBS_DIR, MATLAB_DIR, REPO_ROOT } = require('./config');
const { GROUND_LAYER } = require('./plotTypes');

// 启动一次 MATLAB -batch 执行 job 中所有待画图。
// figures: 本次要画的 job figure 对象列表(与 job.json 顺序一致)
// stdout 协议(由 plot_dispatch.m 输出):
//   PROGRESS i/N          第 i 张成功
//   FIGURE_ERROR i 消息   第 i 张失败(继续画下一张)
//   DONE                  全部完成
function runMatlabJob(job, figures, onFigureDone, onFigureError) {
  return new Promise((resolve, reject) => {
    const jobDir = path.join(JOBS_DIR, job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const jobFile = path.join(jobDir, 'job.json');
    const taskFigures = figures.map((f) => ({
      preddir: f.preddir,
      dataType: f.dataType,
      layer: f.layer === GROUND_LAYER ? '' : f.layer,
      outFile: f.pngFile,
    }));
    fs.writeFileSync(jobFile, JSON.stringify({ figures: taskFigures }));

    const code = `addpath('${MATLAB_DIR}'); plot_dispatch('${jobFile}');`;
    const cmd = `"${config.matlabExe}" -batch "${code}"`;
    const proc = spawn(cmd, { shell: true, windowsHide: true, cwd: REPO_ROOT });

    let stderr = '';
    let sawDone = false;
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^PROGRESS\s+(\d+)\/(\d+)/);
        if (m) {
          onFigureDone(Number(m[1]) - 1);
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
