using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;
namespace PssSetup;

public sealed class SetupOptions {
 public string Destination {get;set;}=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","PSS Console");
 public bool Startup {get;set;}=true;
 public bool Shortcut {get;set;}=true;
 public bool Sounds {get;set;}=true;
 public bool ReducedMotion {get;set;}
 public bool KeepData {get;set;}=true;
 public bool Uninstall {get;set;}
 public bool TempUninstaller {get;set;}
 public bool Silent {get;set;}
 public bool Preview {get;set;}
 public string PreviewPage {get;set;}="welcome";
 public string CaptureDirectory {get;set;}="";
 public string Report {get;set;}="";
 public string Jellyfin {get;set;}="http://127.0.0.1:8096";
 public static SetupOptions Parse(string[] args){var o=new SetupOptions();foreach(var a in args){if(a.StartsWith("--destination="))o.Destination=Path.GetFullPath(a[14..]);if(a.StartsWith("--root="))o.Destination=Path.GetFullPath(a[7..]);if(a.StartsWith("--report="))o.Report=Path.GetFullPath(a[9..]);if(a.StartsWith("--preview=")){o.Preview=true;o.PreviewPage=a[10..];}if(a.StartsWith("--capture-all=")){o.Preview=true;o.CaptureDirectory=Path.GetFullPath(a[14..]);}if(a=="--uninstall")o.Uninstall=true;if(a=="--temp-uninstaller")o.TempUninstaller=true;if(a=="--headless")o.Silent=true;if(a=="--no-startup")o.Startup=false;if(a=="--no-shortcut")o.Shortcut=false;if(a=="--no-sounds")o.Sounds=false;if(a=="--remove-data")o.KeepData=false;}return o;}
}
public record SetupProgress(double Percent,string Stage);
public record SetupResult(bool Success,string Destination,string? Error=null,int Files=0);
public record PayloadManifest(string Version,string Sha256,long UncompressedBytes,int Files);
public static class SetupEngine {
 const string UninstallKey=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PSSConsole";
 const string RunKey=@"Software\Microsoft\Windows\CurrentVersion\Run";
 static readonly string[] OwnedProcesses={"PSS Console","PssHelper"};
 public static bool HasPayload=>Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("PssSetup.Payload");
 public static PayloadManifest? Manifest(){using var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("PssSetup.Manifest");return stream==null?null:JsonSerializer.Deserialize<PayloadManifest>(stream,new JsonSerializerOptions{PropertyNameCaseInsensitive=true});}
 public static string ValidateDestination(string raw,bool installed=false){
  var dest=Path.GetFullPath(raw.Trim().Trim('"')).TrimEnd(Path.DirectorySeparatorChar);
  var root=Path.GetPathRoot(dest)?.TrimEnd(Path.DirectorySeparatorChar);if(string.IsNullOrWhiteSpace(dest)||dest.Equals(root,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Choose a folder for PSS, not an entire drive.");
  foreach(var special in new[]{Environment.SpecialFolder.UserProfile,Environment.SpecialFolder.DesktopDirectory,Environment.SpecialFolder.LocalApplicationData,Environment.SpecialFolder.ApplicationData,Environment.SpecialFolder.Windows,Environment.SpecialFolder.ProgramFiles,Environment.SpecialFolder.ProgramFilesX86}){var p=Environment.GetFolderPath(special);if(p.Length>0&&dest.Equals(p,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Choose a dedicated PSS Console folder.");}
  var windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);if(dest.StartsWith(windows+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Choose a location outside the Windows folder.");
  var current=new DirectoryInfo(dest);while(current!=null){if(current.Exists&&(current.Attributes&FileAttributes.ReparsePoint)!=0)throw new InvalidOperationException("Choose a normal folder instead of a linked folder.");current=current.Parent;}
  if(Directory.Exists(dest)&&Directory.EnumerateFileSystemEntries(dest).Any()&&!File.Exists(Path.Combine(dest,"PSS Console.exe")))throw new InvalidOperationException("This folder contains other files. Choose an empty folder or the existing PSS installation.");
  if(installed&&!File.Exists(Path.Combine(dest,"PSS Console.exe"))&&!File.Exists(Path.Combine(dest,"pss-install.json")))throw new InvalidOperationException("A PSS installation was not found at this location.");
  return dest;
 }
 public static async Task<SetupResult> Install(SetupOptions options,Action<SetupProgress> progress){
  string dest="",stage="",backup="";bool replaced=false;var oldLibrary=await ReadLibrary();
  try {
   dest=ValidateDestination(options.Destination);if(!HasPayload)throw new InvalidOperationException("This executable is the uninstaller. Open PSS Console Setup to install.");
   if(!Uri.TryCreate(options.Jellyfin,UriKind.Absolute,out var u)||u.Scheme is not ("http" or "https"))throw new InvalidOperationException("Enter an http:// or https:// Jellyfin address.");
   var manifest=Manifest()??throw new InvalidDataException("Installation manifest missing.");var parent=Path.GetDirectoryName(dest)!;Directory.CreateDirectory(parent);var available=new DriveInfo(Path.GetPathRoot(dest)!).AvailableFreeSpace;if(available<manifest.UncompressedBytes+64*1024*1024)throw new IOException("There isn't enough free space at this location.");
   stage=dest+".pss-stage-"+Guid.NewGuid().ToString("N");backup=dest+".pss-backup-"+Guid.NewGuid().ToString("N");
   progress(new(1,"Checking your console package…"));
   await Task.Run(()=>{
    using(var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("PssSetup.Payload")!){var hash=Convert.ToHexString(SHA256.HashData(payload));if(!hash.Equals(manifest.Sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Package integrity check failed. Download the setup file again.");}
    using var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("PssSetup.Payload")!;using var zip=new ZipArchive(stream,ZipArchiveMode.Read);Directory.CreateDirectory(stage);long copied=0;int count=0;
    foreach(var item in zip.Entries){var relative=item.FullName.Replace('/',Path.DirectorySeparatorChar);var target=Path.GetFullPath(Path.Combine(stage,relative));if(!target.StartsWith(stage+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Package contains an unsafe path.");if((item.ExternalAttributes>>16&0xF000)==0xA000)throw new InvalidDataException("Package contains a linked file.");if(item.FullName.EndsWith('/')){Directory.CreateDirectory(target);continue;}Directory.CreateDirectory(Path.GetDirectoryName(target)!);using var input=item.Open();using var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None);var buffer=new byte[1024*1024];int read;while((read=input.Read(buffer))>0){output.Write(buffer,0,read);copied+=read;progress(new(5+copied/(double)Math.Max(manifest.UncompressedBytes,1)*79,"Installing your console…"));}count++;}
    if(count!=manifest.Files)throw new InvalidDataException("Package file count doesn't match its manifest.");
   });
   if(!File.Exists(Path.Combine(stage,"PSS Console.exe")))throw new InvalidDataException("Console application is missing from the package.");
   progress(new(86,"Preparing Windows integration…"));await StopOwnedProcesses(dest);
   if(Directory.Exists(dest))Directory.Move(dest,backup);Directory.Move(stage,dest);replaced=true;
   await File.WriteAllTextAsync(Path.Combine(dest,"pss-install.json"),JsonSerializer.Serialize(new{version=manifest.Version,installedAt=DateTimeOffset.UtcNow,files=Directory.GetFiles(dest,"*",SearchOption.AllDirectories).Select(f=>Path.GetRelativePath(dest,f)).ToArray()}));
   progress(new(91,"Making it yours…"));await ApplyPreferences(options);
   Register(options,dest,manifest);
   if(options.Shortcut)CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"PSS Console.lnk"),dest);
   else DeleteShortcutIfOwned(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"PSS Console.lnk"),dest);
   var menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),"Programs","PSS Console.lnk");CreateShortcut(menu,dest);
   try{if(Directory.Exists(backup))await Task.Run(()=>Directory.Delete(backup,true));}catch{ /* A locked backup can be removed later; the new installation is complete. */ }
   progress(new(100,"Your console is ready."));return new(true,dest,null,manifest.Files);
  }catch(Exception e){
   if(replaced){try{if(Directory.Exists(dest))Directory.Delete(dest,true);if(Directory.Exists(backup))Directory.Move(backup,dest);if(oldLibrary!=null)await RestoreLibrary(oldLibrary);}catch{}}
   // A failed stage-to-destination rename must also restore a just-moved original.
   if(!replaced&&backup.Length>0&&Directory.Exists(backup)&&!Directory.Exists(dest))try{Directory.Move(backup,dest);}catch{}
   try{if(stage.Length>0&&Directory.Exists(stage))Directory.Delete(stage,true);}catch{}
   return new(false,dest,e.GetBaseException().Message);
  }
 }
 static string LibraryPath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"pss-console","library.json");
 static async Task<string?> ReadLibrary(){try{return await File.ReadAllTextAsync(LibraryPath);}catch{return null;}}
 static async Task RestoreLibrary(string raw){Directory.CreateDirectory(Path.GetDirectoryName(LibraryPath)!);await File.WriteAllTextAsync(LibraryPath,raw);}
 static async Task ApplyPreferences(SetupOptions o){var raw=await ReadLibrary();var doc=raw==null?new JsonObject():JsonNode.Parse(raw)?.AsObject()??new JsonObject();var settings=doc["settings"] as JsonObject??new JsonObject();if(doc["settings"]==null)doc["settings"]=settings;settings["startup"]=o.Startup;settings["reducedMotion"]=o.ReducedMotion;settings["sounds"]=o.Sounds ? .25 : 0;settings["jellyfin"]=o.Jellyfin;doc["version"]=1;if(doc["entries"]==null)doc["entries"]=new JsonArray();Directory.CreateDirectory(Path.GetDirectoryName(LibraryPath)!);await File.WriteAllTextAsync(LibraryPath+".setup-tmp",doc.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));File.Move(LibraryPath+".setup-tmp",LibraryPath,true);}
 static void Register(SetupOptions options,string dest,PayloadManifest manifest){
  using(var run=Registry.CurrentUser.CreateSubKey(RunKey)){if(options.Startup)run.SetValue("PSS Console","\""+Path.Combine(dest,"PSS Console.exe")+"\" --startup");else run.DeleteValue("PSS Console",false);}
  using(var uninstall=Registry.CurrentUser.CreateSubKey(UninstallKey)){uninstall.SetValue("DisplayName","PSS Console");uninstall.SetValue("DisplayVersion",manifest.Version);uninstall.SetValue("Publisher","PSS");uninstall.SetValue("InstallLocation",dest);uninstall.SetValue("DisplayIcon",Path.Combine(dest,"PSS Console.exe")+",0");uninstall.SetValue("UninstallString","\""+Path.Combine(dest,"Uninstall PSS Console.exe")+"\" --uninstall --root=\""+dest+"\"");uninstall.SetValue("QuietUninstallString","\""+Path.Combine(dest,"Uninstall PSS Console.exe")+"\" --uninstall --headless --root=\""+dest+"\"");uninstall.SetValue("NoModify",1,RegistryValueKind.DWord);uninstall.SetValue("NoRepair",1,RegistryValueKind.DWord);uninstall.SetValue("EstimatedSize",(int)(manifest.UncompressedBytes/1024),RegistryValueKind.DWord);}
  // Migrate only the legacy entry that points to this exact installation.
  const string legacy=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\0d30468f-74ef-5743-9eb5-9002c8ff5711";using(var old=Registry.CurrentUser.OpenSubKey(legacy)){var icon=old?.GetValue("DisplayIcon")?.ToString();if(icon?.StartsWith(Path.Combine(dest,"PSS Console.exe"),StringComparison.OrdinalIgnoreCase)==true){old!.Close();Registry.CurrentUser.DeleteSubKeyTree(legacy,false);}}
 }
 static void CreateShortcut(string file,string dest){Directory.CreateDirectory(Path.GetDirectoryName(file)!);var type=Type.GetTypeFromProgID("WScript.Shell")??throw new InvalidOperationException("Windows shortcut service unavailable.");dynamic shell=Activator.CreateInstance(type)!;try{dynamic link=shell.CreateShortcut(file);try{link.TargetPath=Path.Combine(dest,"PSS Console.exe");link.WorkingDirectory=dest;link.Description="PSS Console";link.IconLocation=Path.Combine(dest,"PSS Console.exe")+",0";link.Save();}finally{System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);}}finally{System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}}
 static void DeleteShortcutIfOwned(string file,string dest){if(!File.Exists(file))return;var type=Type.GetTypeFromProgID("WScript.Shell");if(type==null)return;dynamic shell=Activator.CreateInstance(type)!;try{dynamic link=shell.CreateShortcut(file);try{string target=link.TargetPath;if(target.Equals(Path.Combine(dest,"PSS Console.exe"),StringComparison.OrdinalIgnoreCase))File.Delete(file);}finally{System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);}}finally{System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);}}
 static async Task StopOwnedProcesses(string root){
  var candidates=new List<Process>();foreach(var name in OwnedProcesses)foreach(var process in Process.GetProcessesByName(name)){try{var exe=process.MainModule?.FileName;if(exe!=null&&Path.GetFullPath(exe).StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))candidates.Add(process);}catch{}}
  foreach(var process in candidates.Where(p=>p.ProcessName=="PSS Console"))try{process.CloseMainWindow();}catch{}
  await Task.Delay(candidates.Count>0?450:0);
  foreach(var process in candidates)try{if(!process.HasExited){process.Kill();await process.WaitForExitAsync();}}catch{}
 }
 public static void StartTemporaryUninstaller(SetupOptions options){var temp=Path.Combine(Path.GetTempPath(),"PSS-Uninstall-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);var file=Path.Combine(temp,"PSS Uninstall.exe");File.Copy(Environment.ProcessPath!,file);var info=new ProcessStartInfo(file){UseShellExecute=true};info.ArgumentList.Add("--uninstall");info.ArgumentList.Add("--temp-uninstaller");info.ArgumentList.Add("--root="+options.Destination);if(!options.KeepData)info.ArgumentList.Add("--remove-data");if(options.Silent)info.ArgumentList.Add("--headless");if(options.Report.Length>0)info.ArgumentList.Add("--report="+options.Report);Process.Start(info);}
 public static async Task<SetupResult> Uninstall(SetupOptions options,Action<SetupProgress> progress){
  string dest="";try{
   dest=ValidateDestination(options.Destination,true);var manifestPath=Path.Combine(dest,"pss-install.json");if(!File.Exists(manifestPath))throw new InvalidOperationException("Use the existing uninstaller for installations made before PSS 1.1.");
   using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(manifestPath));var files=doc.RootElement.GetProperty("files").EnumerateArray().Select(e=>e.GetString()!).Append("pss-install.json").ToArray();progress(new(3,"Closing your console…"));await StopOwnedProcesses(dest);
   for(int i=0;i<files.Length;i++){var file=Path.GetFullPath(Path.Combine(dest,files[i]));if(!file.StartsWith(dest+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Unsafe installation manifest.");if(File.Exists(file)){File.SetAttributes(file,FileAttributes.Normal);File.Delete(file);}progress(new(5+(i+1)*85d/files.Length,"Returning your PC to Windows…"));}
   foreach(var dir in Directory.GetDirectories(dest,"*",SearchOption.AllDirectories).OrderByDescending(p=>p.Length))if(!Directory.EnumerateFileSystemEntries(dir).Any())Directory.Delete(dir);if(!Directory.EnumerateFileSystemEntries(dest).Any())Directory.Delete(dest);
   using(var run=Registry.CurrentUser.OpenSubKey(RunKey,true)){var entry=run?.GetValue("PSS Console")?.ToString();if(entry?.Contains(Path.Combine(dest,"PSS Console.exe"),StringComparison.OrdinalIgnoreCase)==true)run!.DeleteValue("PSS Console",false);}
   using(var key=Registry.CurrentUser.OpenSubKey(UninstallKey)){if(key?.GetValue("InstallLocation")?.ToString()?.Equals(dest,StringComparison.OrdinalIgnoreCase)==true){key.Close();Registry.CurrentUser.DeleteSubKeyTree(UninstallKey,false);}}
   DeleteShortcutIfOwned(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"PSS Console.lnk"),dest);DeleteShortcutIfOwned(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),"Programs","PSS Console.lnk"),dest);
   if(!options.KeepData){var data=Path.GetDirectoryName(LibraryPath)!;if(Directory.Exists(data))Directory.Delete(data,true);}
   progress(new(100,"You're back in Windows."));return new(true,dest);
  }catch(Exception e){return new(false,dest,e.GetBaseException().Message);}
 }
}
