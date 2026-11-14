using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Collections.Generic;
using Microsoft.Win32.SafeHandles;
using System.Reflection;

[assembly: AssemblyTitle("AntennaDraw Windows Process Host")]
[assembly: AssemblyDescription("Owns and cleans up only AntennaDraw MATLAB job processes")]
[assembly: AssemblyProduct("AntennaDraw")]
[assembly: AssemblyVersion("1.0.2.0")]
[assembly: AssemblyFileVersion("1.0.2.0")]

// Windows 11: private job, no breakaway; associate at CreateProcess time.
// References: Microsoft Learn Job Objects, UpdateProcThreadAttribute,
// JOBOBJECT_BASIC_ACCOUNTING_INFORMATION. Never terminate by process name/PID.
public static class AntennaProcessHost {
    public static int Main(string[] args) {
        if (args.Length < 4) return 64;
        string[] childArgs = new string[args.Length - 4]; Array.Copy(args, 4, childArgs, 0, childArgs.Length);
        return Run(args[0], childArgs, args[1], args[2], args[3]);
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public uint Size; public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedBytes; public IntPtr ReservedPtr, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Size; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static string stopReason;
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static uint Active(IntPtr job) {
        Accounting info; Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); return info.Active;
    }
    static string Quote(string value) {
        StringBuilder s = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { s.Append('\\', slashes * 2 + 1); s.Append('"'); }
            else { s.Append('\\', slashes); s.Append(c); }
            slashes = 0;
        }
        s.Append('\\', slashes * 2); s.Append('"'); return s.ToString();
    }
    static string Escape(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n"); }
    static Thread Pump(IntPtr read, string channel, StreamWriter writer) {
        Thread thread = new Thread(delegate() {
            try {
                using (FileStream stream = new FileStream(new SafeFileHandle(read, true), FileAccess.Read)) {
                    byte[] bytes = new byte[4096]; int count;
                    while ((count = stream.Read(bytes, 0, bytes.Length)) > 0) {
                        lock (writer) { writer.WriteLine(channel + ":" + Convert.ToBase64String(bytes, 0, count)); writer.Flush(); }
                    }
                }
            } catch { Interlocked.CompareExchange(ref stopReason, "interrupted", null); }
        }); thread.IsBackground = true; thread.Start(); return thread;
    }
    public static int Run(string executable, string[] args, string cwd, string pipeName, string resultFile) {
        IntPtr job = IntPtr.Zero, list = IntPtr.Zero, jobPointer = IntPtr.Zero, handlePointer = IntPtr.Zero;
        IntPtr outRead = IntPtr.Zero, outWrite = IntPtr.Zero, errRead = IntPtr.Zero, errWrite = IntPtr.Zero, input = IntPtr.Zero;
        bool initialized = false, cleaned = true; ProcessInfo process = new ProcessInfo();
        string status = "failed", error = "", jobName = Environment.GetEnvironmentVariable("ANTENNA_JOB_NAME"); int exitCode = -1;
        NamedPipeClientStream pipe = null;
        try {
            pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous); pipe.Connect(10000);
            NamedPipeClientStream connection = pipe;
            StreamWriter writer = new StreamWriter(connection, new UTF8Encoding(false));
            string hostToken = Environment.GetEnvironmentVariable("ANTENNA_HOST_TOKEN");
            if (String.IsNullOrEmpty(hostToken)) throw new Exception("Missing host authentication token");
            writer.WriteLine("H:" + hostToken); writer.Flush();
            Environment.SetEnvironmentVariable("ANTENNA_HOST_TOKEN", null);
            Thread reader = new Thread(delegate() {
                try {
                    string line = new StreamReader(connection, Encoding.UTF8).ReadLine();
                    string reason = line == "timed_out" ? "timed_out" : line == "cancelled" ? "cancelled" : "interrupted";
                    Interlocked.CompareExchange(ref stopReason, reason, null);
                } catch { Interlocked.CompareExchange(ref stopReason, "interrupted", null); }
            }); reader.IsBackground = true; reader.Start();
            if (String.IsNullOrEmpty(jobName) || !System.Text.RegularExpressions.Regex.IsMatch(jobName, @"^Local\\AntennaDraw-[0-9a-f-]{36}$")) throw new Exception("Invalid job identity");
            job = CreateJobObjectW(IntPtr.Zero, jobName); Check(job != IntPtr.Zero);
            if (Marshal.GetLastWin32Error() == 183) {
                CloseHandle(job); job = IntPtr.Zero;
                throw new Exception("Job identity already exists");
            }
            ExtendedLimit limit = new ExtendedLimit(); limit.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway flags.
            Check(SetInformationJobObject(job, 9, ref limit, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            list = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list, 2, 0, ref size)); initialized = true;
            jobPointer = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobPointer, job);
            Check(UpdateProcThreadAttribute(list, 0, new IntPtr(0x2000D), jobPointer, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            StartupEx startup = new StartupEx(); startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = list;
            startup.Startup.Flags = 0x100;
            SecurityAttributes security = new SecurityAttributes(); security.Size = Marshal.SizeOf(typeof(SecurityAttributes)); security.Inherit = 1;
            Check(CreatePipe(out outRead, out outWrite, ref security, 0)); Check(SetHandleInformation(outRead, 1, 0));
            Check(CreatePipe(out errRead, out errWrite, ref security, 0)); Check(SetHandleInformation(errRead, 1, 0));
            input = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero); Check(input != new IntPtr(-1));
            startup.Startup.Input = input; startup.Startup.Output = outWrite; startup.Startup.Error = errWrite;
            List<IntPtr> handles = new List<IntPtr>();
            foreach (IntPtr handle in new IntPtr[] { startup.Startup.Input, startup.Startup.Output, startup.Startup.Error }) {
                if (handle == IntPtr.Zero || handle == new IntPtr(-1)) throw new Exception("Invalid standard handle");
                Check(SetHandleInformation(handle, 1, 1)); if (!handles.Contains(handle)) handles.Add(handle);
            }
            handlePointer = Marshal.AllocHGlobal(handles.Count * IntPtr.Size);
            for (int i = 0; i < handles.Count; i++) Marshal.WriteIntPtr(handlePointer, i * IntPtr.Size, handles[i]);
            Check(UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handlePointer, new IntPtr(handles.Count * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            if (stopReason == null) {
                StringBuilder command = new StringBuilder(Quote(executable)); foreach (string arg in args) command.Append(" ").Append(Quote(arg));
                // JOB_LIST attaches the child before its initial thread runs.
                // No suspended process or thread-resume API is needed.
                Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080000, IntPtr.Zero, cwd, ref startup, out process));
                cleaned = false;
                CloseHandle(outWrite); outWrite = IntPtr.Zero; CloseHandle(errWrite); errWrite = IntPtr.Zero;
                Thread outPump = Pump(outRead, "O", writer); outRead = IntPtr.Zero;
                Thread errPump = Pump(errRead, "E", writer); errRead = IntPtr.Zero;
                bool terminated = false; DateTime stopAt = DateTime.MaxValue;
                while (Active(job) != 0) {
                    if (stopReason != null && !terminated) { Check(TerminateJobObject(job, 1)); terminated = true; stopAt = DateTime.UtcNow.AddSeconds(10); }
                    if (DateTime.UtcNow > stopAt) throw new Exception("Job did not reach zero active processes");
                    Thread.Sleep(25);
                }
                cleaned = true; uint code; Check(GetExitCodeProcess(process.Process, out code)); exitCode = unchecked((int)code);
                if (!outPump.Join(5000) || !errPump.Join(5000)) throw new Exception("Output pipes did not close");
            }
            status = stopReason ?? (exitCode == 0 ? "done" : "failed");
        } catch (Exception e) {
            error = e.Message;
            if (job != IntPtr.Zero) {
                try {
                    Check(TerminateJobObject(job, 1)); DateTime deadline = DateTime.UtcNow.AddSeconds(10);
                    while (Active(job) != 0 && DateTime.UtcNow < deadline) Thread.Sleep(25);
                    cleaned = Active(job) == 0;
                } catch { cleaned = false; }
            }
        } finally {
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            foreach (IntPtr handle in new IntPtr[] { outRead, outWrite, errRead, errWrite, input }) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (jobPointer != IntPtr.Zero) Marshal.FreeHGlobal(jobPointer);
            if (handlePointer != IntPtr.Zero) Marshal.FreeHGlobal(handlePointer);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (pipe != null) pipe.Dispose();
        }
        string result = "{\"schemaVersion\":2,\"jobName\":\"" + Escape(jobName ?? "") + "\",\"status\":\"" + status + "\",\"exitCode\":" + exitCode + ",\"pid\":" + process.Pid + ",\"cleanupConfirmed\":" + (cleaned ? "true" : "false") + ",\"error\":\"" + Escape(error) + "\"}";
        File.WriteAllText(resultFile + ".tmp", result, new UTF8Encoding(false)); File.Move(resultFile + ".tmp", resultFile);
        return cleaned ? 0 : 2;
    }
}
