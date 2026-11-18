param([Parameter(Mandatory=$true)][int]$TargetProcessId,[switch]$ReportMetrics)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InboxLoadJob {
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO {
    public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Extended {
    public Basic BasicLimitInformation;
    public IO IoInfo;
    public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, Processes, Active, Terminated;
    public IO IoInfo;
  }
  [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject",SetLastError=true)] public static extern bool QueryAccounting(IntPtr job,int cls,ref Accounting info,uint size,IntPtr length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int cls,ref Extended info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job,int cls,ref Extended info,uint size,IntPtr length);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$taskProcess = Get-Process -Id $TargetProcessId
$taskProcess.ProcessorAffinity = [intptr]3
$taskJob = [InboxLoadJob]::CreateJobObject([IntPtr]::Zero,$null)
if ($taskJob -eq [IntPtr]::Zero) { throw 'CreateJobObject failed' }
try {
  $limits = New-Object InboxLoadJob+Extended
  # JOB_MEMORY, AFFINITY and KILL_ON_JOB_CLOSE include all producer children.
  $limits.BasicLimitInformation.LimitFlags = 0x2210
  $limits.BasicLimitInformation.Affinity = [UIntPtr]::new([UInt64]3)
  $limits.JobMemoryLimit = [UIntPtr]::new([UInt64]2147483648)
  $size = [Runtime.InteropServices.Marshal]::SizeOf($limits)
  if (-not [InboxLoadJob]::SetInformationJobObject($taskJob,9,[ref]$limits,$size)) { throw "SetInformationJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if (-not [InboxLoadJob]::AssignProcessToJobObject($taskJob,$taskProcess.Handle)) { throw "AssignProcessToJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  Write-Output 'RESOURCE_LIMITS_READY cpuAffinity=3 jobMemoryBytes=2147483648'
  $taskProcess.WaitForExit()
  if ($ReportMetrics) {
    $measured = New-Object InboxLoadJob+Extended
    if (-not [InboxLoadJob]::QueryInformationJobObject($taskJob,9,[ref]$measured,$size,[IntPtr]::Zero)) { throw 'QueryInformationJobObject failed' }
    Write-Output "RESOURCE_LIMITS_METRICS peakJobMemoryBytes=$($measured.PeakJobMemoryUsed.ToUInt64())"
    $usage = New-Object InboxLoadJob+Accounting
    if (-not [InboxLoadJob]::QueryAccounting($taskJob,8,[ref]$usage,[Runtime.InteropServices.Marshal]::SizeOf($usage),[IntPtr]::Zero)) { throw 'QueryAccounting failed' }
    Write-Output "JOB_ACCOUNTING cpu100ns=$($usage.UserTime + $usage.KernelTime) writeBytes=$($usage.IoInfo.WriteTransferCount) readBytes=$($usage.IoInfo.ReadTransferCount) processes=$($usage.Processes)"
  }
} finally { [void][InboxLoadJob]::CloseHandle($taskJob) }
