const path = require('node:path');
const { spawn } = require('node:child_process');

// Recovery must still work when antivirus has quarantined the optional host EXE.
// Only Windows' own PowerShell runs here. The fixed, reviewable probe opens our
// random Job by name; it never kills a process by name or a persisted PID.
const probeSource = String.raw`
using System;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AntennaJobRecovery {
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel;
    public uint Faults, Total, Active, Terminated;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int cls, out Accounting info, uint size, IntPtr returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Inspect(string jobName, string executableName, int hostPid, bool hostExited) {
    bool hostAlive = false, executableAlive = false;
    foreach (Process p in Process.GetProcesses()) {
      using (p) {
        try {
          string name = p.ProcessName;
          bool host = name.Equals("WindowsProcessHost", StringComparison.OrdinalIgnoreCase) || name.StartsWith("AntennaProcessHost-", StringComparison.OrdinalIgnoreCase);
          if (!hostExited && host && (hostPid == 0 || p.Id == hostPid)) hostAlive = true;
          if (name.Equals(executableName, StringComparison.OrdinalIgnoreCase)) executableAlive = true;
        } catch (InvalidOperationException) { } // Process exited during enumeration.
      }
    }
    if (hostAlive) return "{\"cleanupConfirmed\":false,\"reason\":\"host_still_running\"}";
    if (String.IsNullOrEmpty(jobName)) {
      // 1.0.0 had unnamed KILL_ON_JOB_CLOSE Jobs. With no host and no target
      // process, the old Job has lost its sole owning handle. Be conservative
      // when any process with the target name is still present.
      return executableAlive ? "{\"cleanupConfirmed\":false,\"reason\":\"legacy_executable_still_running\"}" : "{\"cleanupConfirmed\":true,\"reason\":\"legacy_host_and_executable_absent\"}";
    }
    IntPtr job = OpenJobObjectW(4, false, jobName); // JOB_OBJECT_QUERY only.
    if (job == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 2) return "{\"cleanupConfirmed\":true,\"reason\":\"job_no_longer_exists\"}";
      throw new Win32Exception(error);
    }
    try {
      Accounting info;
      if (!QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return "{\"cleanupConfirmed\":" + (info.Active == 0 ? "true" : "false") + ",\"reason\":\"job_accounting\",\"activeProcesses\":" + info.Active + "}";
    } finally { CloseHandle(job); }
  }
}`;

async function inspectOwnedProcesses({ jobName, executable, hostPid, hostExited = false }) {
  if (process.platform !== 'win32') throw new Error('进程恢复核验仅支持 Windows');
  if (jobName !== undefined && !/^Local\\AntennaDraw-[0-9a-f-]{36}$/i.test(jobName)) throw new Error('进程 Job 归属标识无效');
  if (!jobName && (!path.isAbsolute(executable || '') || path.extname(executable).toLowerCase() !== '.exe')) throw new Error('旧进程归属记录缺少可核验的可执行文件');
  const env = { ...process.env, ANTENNA_RECOVERY_SOURCE: probeSource, ANTENNA_RECOVERY_JOB: jobName || '',
    ANTENNA_RECOVERY_EXE: executable ? path.basename(executable, path.extname(executable)) : '',
    ANTENNA_RECOVERY_HOST_PID: String(Number.isInteger(hostPid) && hostPid > 0 ? hostPid : 0), ANTENNA_RECOVERY_HOST_EXITED: hostExited ? '1' : '0' };
  for (const key of Object.keys(env)) if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete env[key];
  const executablePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); Add-Type -TypeDefinition $env:ANTENNA_RECOVERY_SOURCE; [AntennaJobRecovery]::Inspect($env:ANTENNA_RECOVERY_JOB,$env:ANTENNA_RECOVERY_EXE,[int]$env:ANTENNA_RECOVERY_HOST_PID,$env:ANTENNA_RECOVERY_HOST_EXITED -eq '1')";
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
    child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-8000); });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-2000); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || timedOut) return reject(new Error('无法核验 MATLAB 进程归属：' + (timedOut ? 'Windows 核验超时' : stderr.trim())));
      try { const result = JSON.parse(stdout.trim()); if (typeof result.cleanupConfirmed !== 'boolean') throw new Error('核验结果无效'); resolve(result); }
      catch (error) { reject(new Error('Windows 进程恢复结果无效：' + error.message)); }
    });
  });
}

module.exports = { inspectOwnedProcesses };
