import { terminalJobStates } from './jobModel.mjs';
export function watchJob({ read, update = () => {}, interval = 1500 }) {
  let stopped = false, timer, finish, reject;
  const finished = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
  async function tick() {
    try {
      const job = await read();
      if (stopped) return;
      update(job);
      if (terminalJobStates.has(job.status)) { stopped = true; finish(job); }
      else timer = setTimeout(tick, interval);
    } catch (error) { if (!stopped) { stopped = true; reject(error); } }
  }
  timer = setTimeout(tick, 0);
  return { finished, stop() { if (stopped) return; stopped = true; clearTimeout(timer); finish(); } };
}
