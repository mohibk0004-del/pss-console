using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace PssHelper;

static class Program
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly object OutputLock = new();
    static readonly ConcurrentQueue<JsonElement> Commands = new();
    static volatile bool Alive = true;
    static string Mode = "desktop";
    static string Browser = "brave";
    static nint ShellWindow;
    static readonly HashSet<int> MouseButtons = new();
    static long BrowserUntil;
    static readonly Dictionary<string,long> Repeats = new();
    static long ChordStart;
    static bool ChordFired;
    static bool SdlReady;
    static nint Pad;
    static uint PadId;
    static bool[] Previous = new bool[26];
    static int LastFamily = -1;
    sealed record Activation(JsonElement Command,nint Window,string Token,long Deadline);
    static readonly List<Activation> Activations = new();

    [STAThread]
    static void Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if(args.Contains("--windows")){Console.WriteLine(JsonSerializer.Serialize(Windows(),Json));return;}
        if (args.Contains("--self-test")) { SelfTest(); return; }
        Task.Run(() => { string? line; while ((line = Console.ReadLine()) != null) { try { Commands.Enqueue(JsonDocument.Parse(line).RootElement.Clone()); } catch (Exception e) { Emit(new { type="error", message=e.Message }); } } Alive=false; });
        try {
            SDL_SetHint("SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS","1");
            SDL_SetHint("SDL_JOYSTICK_HIDAPI_PS5","1");
            SDL_SetHint("SDL_JOYSTICK_HIDAPI_PS4","1");
            SdlReady=SDL_Init(0x00002000);
        } catch (Exception e) { Emit(new {type="error",message="Controller support unavailable: "+e.Message}); }
        Emit(new { type="ready", sdl=SdlReady });
        long nextDevices=0, nextStatus=0;
        try {
            while(Alive) {
                while(Commands.TryDequeue(out var command)) { try { Dispatch(command); } catch(Exception e) { Reply(command,null,e.GetBaseException().Message); } }
                foreach(var activation in Activations.ToArray()) {
                    bool focused=GetForegroundWindow()==activation.Window;
                    if(focused||!IsWindow(activation.Window)||Environment.TickCount64>=activation.Deadline) {
                        Reply(activation.Command,new {focused,window=activation.Window.ToInt64().ToString()});Activations.Remove(activation);
                    }
                }
                if(SdlReady) {
                    SDL_PumpEvents(); SDL_UpdateGamepads();
                    if(Environment.TickCount64>=nextDevices) { UpdateDevices(); nextDevices=Environment.TickCount64+1000; }
                    if(Pad!=0) Poll();
                }
                if(Environment.TickCount64>=nextStatus) { Emit(new { type="windows", data=Windows() });nextStatus=Environment.TickCount64+(Mode=="desktop"?8000:Mode=="launching"?400:Mode=="game"||Mode=="overlay"?1000:2000); }
                // No 60 Hz wakeups without a controller; desktop never needs pointer polling.
                Thread.Sleep(Mode=="desktop"?200:Pad==0?100:Mode=="game"?33:16);
            }
        } finally { Release(); if(Pad!=0)SDL_CloseGamepad(Pad);if(SdlReady)SDL_Quit(); }
    }
    static void Emit(object data) {lock(OutputLock)Console.WriteLine(JsonSerializer.Serialize(data,Json));}
    static string Str(JsonElement e,string key,string fallback="") => e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString()??fallback:fallback;
    static void Reply(JsonElement command,object? data,string? error=null) { Emit(new {type="reply",id=command.GetProperty("id").GetInt32(),data,error}); }
    static void Dispatch(JsonElement c)
    {
        var op=Str(c,"op");var d=c.TryGetProperty("data",out var v)?v:default;
        switch(op) {
            case "mode": Mode=Str(d,"mode","desktop");Browser=Str(d,"browser","brave");ShellWindow=(nint)(d.TryGetProperty("window",out var h)?h.GetInt64():0); Release(); Reply(c,true);break;
            case "keyboardPrepare": if(long.TryParse(Str(d,"window"),out var browserHandle)&&IsWindow((nint)browserHandle)){GetWindowThreadProcessId((nint)browserHandle,out var browserPid);try{if(Process.GetProcessById((int)browserPid).ProcessName.Equals(Browser,StringComparison.OrdinalIgnoreCase))LastBrowserWindow=(nint)browserHandle;}catch{}}else IsBrowserForeground();Reply(c,LastBrowserWindow!=0&&IsWindow(LastBrowserWindow));break;
            case "text": if(Mode=="browser" || Mode=="keyboard") { if(LastBrowserWindow!=0){Focus(LastBrowserWindow);Thread.Sleep(80);}if(GetForegroundWindow()==LastBrowserWindow&&IsBrowserForeground())TypeText(Str(d,"text"));else throw new InvalidOperationException("Windows couldn't focus the selected browser window. Focus it and try again."); } else throw new InvalidOperationException("Browser keyboard is not active.");Reply(c,true);break;
            case "key": if(IsBrowserForeground()) { Key(Str(d,"key") switch {"enter"=>0x0D,"backspace"=>0x08,"tab"=>0x09,_=>0x1B}); }Reply(c,true);break;
            case "desktop": Mode="desktop";Release();try {var type=Type.GetTypeFromProgID("Shell.Application");if(type!=null){dynamic shell=Activator.CreateInstance(type)!;shell.MinimizeAll();Marshal.FinalReleaseComObject(shell);}}catch{}Reply(c,true);break;
            case "focus": var hwnd=(nint)long.Parse(Str(d,"window","0")); Focus(hwnd);Reply(c,GetForegroundWindow()==hwnd);break;
            case "activate": var target=(nint)long.Parse(Str(d,"window","0"));Focus(target);int activationWait=d.TryGetProperty("timeoutMs",out var wait)?Math.Clamp(wait.GetInt32(),1,2000):2000;Activations.Add(new Activation(c.Clone(),target,Str(d,"token"),Environment.TickCount64+activationWait));break;
            case "restore": var restoring=(nint)long.Parse(Str(d,"window","0"));Reply(c,IsWindow(restoring)&&ShowWindowAsync(restoring,9));break;
            case "cancelActivation": foreach(var activation in Activations.Where(a=>a.Token==Str(d,"token")).ToArray()){Reply(activation.Command,new {focused=false,cancelled=true});Activations.Remove(activation);}Reply(c,true);break;
            case "close": var closing=(nint)long.Parse(Str(d,"window","0"));Reply(c,IsWindow(closing)&&PostMessage(closing,0x0010,0,0));break;
            case "volume": Key(Str(d,"action") switch {"up"=>0xAF,"down"=>0xAE,_=>0xAD});Reply(c,true);break;
            case "sleep": Reply(c,true); System.Windows.Forms.Application.SetSuspendState(System.Windows.Forms.PowerState.Suspend,false,false);break;
            case "windows": Reply(c,Windows());break;
            case "windowText": var textWindow=(nint)long.Parse(Str(d,"window","0"));var parts=new List<string>();EnumChildWindows(textWindow,(child,l)=>{var text=new StringBuilder(1024);GetWindowText(child,text,text.Capacity);if(text.Length>0)parts.Add(text.ToString());return parts.Sum(p=>p.Length)<4096;},0);Reply(c,string.Join(" ",parts).Trim());break;
            case "processAlive": bool alive=false;if(d.TryGetProperty("pid",out var processId))try{using var process=Process.GetProcessById(processId.GetInt32());alive=!process.HasExited;}catch{}Reply(c,alive);break;
            case "discover": Reply(c,Discover());break;
            case "icon": Reply(c,IconFor(Str(d,"path"),d.TryGetProperty("index",out var iconIndex)?iconIndex.GetInt32():0));break;
            case "quit": Release();Reply(c,true);Alive=false;break;
            default: throw new InvalidOperationException("Unknown helper command.");
        }
    }
    static void UpdateDevices()
    {
        nint list=SDL_GetGamepads(out int count);var ids=new List<uint>();
        try {for(int i=0;i<count;i++)ids.Add((uint)Marshal.ReadInt32(list,i*4));} finally {if(list!=0)SDL_free(list);}
        // Prefer the physical PlayStation device over a simultaneous virtual XInput device.
        uint chosen=ids.FirstOrDefault(id=>SDL_GetGamepadTypeForID(id) is 4 or 5 or 6);
        if(chosen==0)chosen=ids.Contains(PadId)?PadId:ids.FirstOrDefault();
        if(chosen!=PadId) { Release();if(Pad!=0)SDL_CloseGamepad(Pad);Pad=chosen==0?0:SDL_OpenGamepad(chosen);PadId=Pad==0?0:chosen;Previous=new bool[26];Repeats.Clear();ChordStart=0;ChordFired=false;LastFamily=-1; }
        int family=Pad==0?0:SDL_GetGamepadType(Pad);
        Emit(new {type="controller",data=new {connected=Pad!=0,name=Pad==0?"No controller":Marshal.PtrToStringUTF8(SDL_GetGamepadName(Pad))??"Controller",family=family is 4 or 5 or 6?"playstation":"xbox",count}});
        LastFamily=family;
    }
    static nint LastBrowserWindow;
    static bool IsBrowserForeground()
    {
        var hwnd=GetForegroundWindow();GetWindowThreadProcessId(hwnd,out uint pid);
        try { var name=Process.GetProcessById((int)pid).ProcessName;var yes=name.Equals(Browser,StringComparison.OrdinalIgnoreCase);if(yes)LastBrowserWindow=hwnd;return yes; }catch{return false;}
    }
    static void Poll()
    {
        var now=Environment.TickCount64;var b=new bool[26];for(int i=0;i<b.Length;i++)b[i]=SDL_GetGamepadButton(Pad,i);
        bool chord=b[4]&&b[6];
        if(chord&&Mode!="desktop") {if(ChordStart==0)ChordStart=now;if(now-ChordStart>=1000&&!ChordFired){ChordFired=true;Release();Emit(new {type="input",action="system"});}}
        else {ChordStart=0;ChordFired=false;}
        if(Mode=="desktop"){Previous=b;return;}
        if(b[5]&&!Previous[5]){Release();Emit(new {type="input",action="system"});}
        bool shell=GetForegroundWindow()==ShellWindow;
        if(Mode=="browser"&&!shell&&IsBrowserForeground()) {
            float x=Axis(0),y=Axis(1),scroll=Axis(3);int dx=(int)(x*Math.Abs(x)*23),dy=(int)(y*Math.Abs(y)*23);
            if(dx!=0||dy!=0)Mouse(dx,dy,0,1);
            if(Math.Abs(scroll)>.25&&now>=BrowserUntil) {Mouse(0,0,(int)(-scroll*120),0x0800);BrowserUntil=now+70;}
            if(b[0]&&!Previous[0])Mouse(0,0,0,0x0002);
            if(!b[0]&&Previous[0])Mouse(0,0,0,0x0004);
            if(b[0])MouseButtons.Add(0);else MouseButtons.Remove(0);
            if(b[1]&&!Previous[1]) { KeyDown(0x12);Key(0x25);KeyUp(0x12); }
            if(b[3]&&!Previous[3]) {Mode="keyboard";Release();Emit(new {type="input",action="keyboard"});}
            if(b[11]&&!Previous[11])Key(0x26);if(b[12]&&!Previous[12])Key(0x28);if(b[13]&&!Previous[13])Key(0x25);if(b[14]&&!Previous[14])Key(0x27);
        } else {
            Release();
            if(shell&&(Mode=="shell"||Mode=="overlay"||Mode=="keyboard"||Mode=="launching")) {
                Input("up",b[11]||Axis(1)<-.6,now);Input("down",b[12]||Axis(1)>.6,now);Input("left",b[13]||Axis(0)<-.6,now);Input("right",b[14]||Axis(0)>.6,now);
                if(b[0]&&!Previous[0])Emit(new {type="input",action="confirm"});
                if(b[1]&&!Previous[1])Emit(new {type="input",action="back"});
                if(b[2]&&!Previous[2])Emit(new {type="input",action="favorite"});
                if(b[3]&&!Previous[3])Emit(new {type="input",action="search"});
                if(b[9]&&!Previous[9])Emit(new {type="input",action="previousTab"});
                if(b[10]&&!Previous[10])Emit(new {type="input",action="nextTab"});
                if(b[6]&&!Previous[6]&&!chord)Emit(new {type="input",action="control"});
            }
        }
        Previous=b;
    }
    static void Input(string action,bool held,long now) {if(!held){Repeats.Remove(action);return;}if(!Repeats.TryGetValue(action,out long next)){Emit(new {type="input",action});Repeats[action]=now+360;}else if(now>=next){Emit(new {type="input",action});Repeats[action]=now+110;}}
    static float Axis(int axis) {var f=SDL_GetGamepadAxis(Pad,axis)/32767f;return Math.Abs(f)<.18?0:f;}
    static void Release(){if(MouseButtons.Count>0){Mouse(0,0,0,0x0004);MouseButtons.Clear();}}
    static void Focus(nint hwnd){if(hwnd==0||!IsWindow(hwnd))return;if(IsIconic(hwnd))ShowWindow(hwnd,9);var currentThread=GetCurrentThreadId();var foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out _);bool attached=false;try{if(currentThread!=foregroundThread)attached=AttachThreadInput(currentThread,foregroundThread,true);BringWindowToTop(hwnd);SetForegroundWindow(hwnd);}finally{if(attached)AttachThreadInput(currentThread,foregroundThread,false);}}
    static void Key(int code){KeyDown(code);KeyUp(code);}
    static void KeyDown(int code)=>Send(new INPUT{type=1,u=new InputUnion{ki=new KEYBDINPUT{wVk=(ushort)code}}});
    static void KeyUp(int code)=>Send(new INPUT{type=1,u=new InputUnion{ki=new KEYBDINPUT{wVk=(ushort)code,dwFlags=2}}});
    static void TypeText(string text){
        int length=Math.Min(text.Length,4096);var input=new INPUT[length*2];
        for(int i=0;i<length;i++){input[i*2]=new INPUT{type=1,u=new InputUnion{ki=new KEYBDINPUT{wScan=text[i],dwFlags=4}}};input[i*2+1]=new INPUT{type=1,u=new InputUnion{ki=new KEYBDINPUT{wScan=text[i],dwFlags=6}}};}
        if(input.Length>0&&SendInput((uint)input.Length,input,Marshal.SizeOf<INPUT>())!=(uint)input.Length)throw new InvalidOperationException("Windows blocked text input. Focus the normal, non-administrator browser and try again.");
    }
    static void Mouse(int dx,int dy,int data,uint flags)=>Send(new INPUT{type=0,u=new InputUnion{mi=new MOUSEINPUT{dx=dx,dy=dy,mouseData=unchecked((uint)data),dwFlags=flags}}});
    static void Send(INPUT input,bool strict=false){if(SendInput(1,new[]{input},Marshal.SizeOf<INPUT>())==0&&strict)throw new InvalidOperationException("Windows blocked text input. Focus the normal, non-administrator browser and try again.");}
    static object[] Windows()
    {
        var result=new List<object>();
        EnumWindows((hwnd,l)=>{if(!IsWindowVisible(hwnd))return true;var title=new StringBuilder(1024);GetWindowText(hwnd,title,title.Capacity);if(title.Length==0)return true;GetWindowThreadProcessId(hwnd,out uint pid);try{using var p=Process.GetProcessById((int)pid);GetClientRect(hwnd,out var bounds);var className=new StringBuilder(256);GetClassName(hwnd,className,className.Capacity);int cloaked=0;DwmGetWindowAttribute(hwnd,14,out cloaked,sizeof(int));result.Add(new{window=hwnd.ToInt64().ToString(),pid,title=title.ToString(),process=p.ProcessName,className=className.ToString(),foreground=hwnd==GetForegroundWindow(),minimized=IsIconic(hwnd),cloaked=cloaked!=0,owner=GetWindow(hwnd,4).ToInt64().ToString(),toolWindow=(GetWindowLongPtrW(hwnd,-20).ToInt64()&0x80)!=0,bounds=new {width=bounds.Right-bounds.Left,height=bounds.Bottom-bounds.Top}});}catch{}return true;},0);
        return result.ToArray();
    }
    static string? IconFor(string file,int index=0)
    {
        try {if(!File.Exists(file))return null;using var icon=Icon.ExtractIcon(file,index,128)??Icon.ExtractAssociatedIcon(file);if(icon==null)return null;using var bmp=icon.ToBitmap();using var stream=new MemoryStream();bmp.Save(stream,ImageFormat.Png);return "data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());}catch{return null;}
    }
    static object Discover()
    {
        var installed=new List<object>();var shortcuts=new List<object>();var warnings=new List<string>();
        foreach(var hive in new[]{RegistryHive.LocalMachine,RegistryHive.CurrentUser})foreach(var view in new[]{RegistryView.Registry64,RegistryView.Registry32}) {
            try {using var root=RegistryKey.OpenBaseKey(hive,view);using var un=root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");if(un==null)continue;
                foreach(string key in un.GetSubKeyNames()) {using var item=un.OpenSubKey(key);string title=item?.GetValue("DisplayName")?.ToString()??"",location=item?.GetValue("InstallLocation")?.ToString()??"",icon=item?.GetValue("DisplayIcon")?.ToString()??"",publisher=item?.GetValue("Publisher")?.ToString()??"";if(title.Length==0)continue;installed.Add(new{key,title,location,icon,publisher});}
            }catch(Exception e){warnings.Add(e.Message);}
        }
        var roots=new[]{Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)};
        Type? shellType=Type.GetTypeFromProgID("WScript.Shell");object? com=shellType==null?null:Activator.CreateInstance(shellType);
        try {foreach(var root in roots) {if(!Directory.Exists(root))continue;IEnumerable<string> links;try{links=Directory.EnumerateFiles(root,"*.lnk",SearchOption.AllDirectories).ToArray();}catch{continue;}
            foreach(var file in links.Take(2500)) {try {dynamic shell=com!;dynamic link=shell.CreateShortcut(file);string target=(string)link.TargetPath,args=(string)link.Arguments,cwd=(string)link.WorkingDirectory;shortcuts.Add(new{path=file,title=Path.GetFileNameWithoutExtension(file),target,args,cwd});Marshal.FinalReleaseComObject(link);}catch{}}
        }}finally{if(com!=null)Marshal.FinalReleaseComObject(com);}
        using var http=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice");string progId=http?.GetValue("ProgId")?.ToString()??"";
        using var cmd=Registry.ClassesRoot.OpenSubKey(progId+@"\shell\open\command");var browserCommand=cmd?.GetValue("")?.ToString()??"";string browserPath=Regex.Match(browserCommand,"^\"([^\"]+)\"").Groups[1].Value;
        return new {installed,shortcuts,browserPath,browserProgId=progId,warnings};
    }
    static void SelfTest(){Emit(new {type="self-test",inputSize=Marshal.SizeOf<INPUT>(),windows=Windows().Length,discovery=Discover(),icon=IconFor(Environment.ProcessPath!)});}

    [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public InputUnion u;}
    [StructLayout(LayoutKind.Explicit)] struct InputUnion {[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {public int dx,dy;public uint mouseData,dwFlags,time;public nuint dwExtraInfo;}
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {public ushort wVk,wScan;public uint dwFlags,time;public nuint dwExtraInfo;}
    delegate bool EnumProc(nint hwnd,nint param);
    [DllImport("user32.dll")]static extern nint GetForegroundWindow();
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]static extern bool AttachThreadInput(uint attach,uint attachTo,bool enabled);
    [DllImport("user32.dll")]static extern bool BringWindowToTop(nint hwnd);
    [DllImport("user32.dll")]static extern bool IsWindow(nint hwnd);
    [StructLayout(LayoutKind.Sequential)]struct RECT {public int Left,Top,Right,Bottom;}
    [DllImport("user32.dll")]static extern bool GetClientRect(nint hwnd,out RECT rect);
    [DllImport("user32.dll")]static extern nint GetWindow(nint hwnd,uint command);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]static extern nint GetWindowLongPtrW(nint hwnd,int index);
    [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(nint hwnd,uint attribute,out int value,int size);
    [DllImport("user32.dll")]static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")]static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")]static extern bool ShowWindow(nint hwnd,int cmd);
    [DllImport("user32.dll")]static extern bool ShowWindowAsync(nint hwnd,int cmd);
    [DllImport("user32.dll")]static extern bool PostMessage(nint hwnd,uint message,nint wParam,nint lParam);
    [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(nint hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(nint hwnd,StringBuilder text,int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(nint hwnd,StringBuilder text,int max);
    [DllImport("user32.dll")]static extern bool EnumChildWindows(nint parent,EnumProc callback,nint param);
    [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,nint param);
    [DllImport("user32.dll")]static extern uint SendInput(uint count,INPUT[] input,int size);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)]static extern bool SDL_SetHint([MarshalAs(UnmanagedType.LPUTF8Str)]string name,[MarshalAs(UnmanagedType.LPUTF8Str)]string value);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)]static extern bool SDL_Init(uint flags);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_Quit();
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_PumpEvents();
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_UpdateGamepads();
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern nint SDL_GetGamepads(out int count);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_free(nint memory);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern int SDL_GetGamepadTypeForID(uint id);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern int SDL_GetGamepadType(nint pad);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern nint SDL_OpenGamepad(uint id);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_CloseGamepad(nint pad);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern nint SDL_GetGamepadName(nint pad);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)]static extern bool SDL_GetGamepadButton(nint pad,int button);
    [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern short SDL_GetGamepadAxis(nint pad,int axis);
}
