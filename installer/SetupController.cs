using System.Runtime.InteropServices;
using System.Windows.Threading;
namespace PssSetup;
// Native pad polling only while the custom wizard has focus; no injected PC input.
public sealed class SetupController:IDisposable {
 readonly DispatcherTimer timer=new(){Interval=TimeSpan.FromMilliseconds(33)};
 readonly Func<bool> active;
 readonly Action<string> dispatch;
 nint pad;uint id;long nextDevices;long nextRepeat;string held="";bool a,b;bool ready;
 public SetupController(Func<bool> active,Action<string> dispatch){this.active=active;this.dispatch=dispatch;try{ready=SDL_Init(0x2000);if(ready){timer.Tick+=Tick;timer.Start();}}catch{}}
 void Tick(object? sender,EventArgs e){if(!active())return;SDL_PumpEvents();SDL_UpdateGamepads();if(Environment.TickCount64>=nextDevices){var ids=SDL_GetGamepads(out int count);uint chosen=count>0?(uint)Marshal.ReadInt32(ids):0;if(ids!=0)SDL_free(ids);if(chosen!=id){if(pad!=0)SDL_CloseGamepad(pad);pad=chosen==0?0:SDL_OpenGamepad(chosen);id=pad==0?0:chosen;}nextDevices=Environment.TickCount64+1000;}if(pad==0)return;var confirm=SDL_GetGamepadButton(pad,0);var back=SDL_GetGamepadButton(pad,1);if(confirm&&!a)dispatch("confirm");if(back&&!b)dispatch("back");a=confirm;b=back;string direction=SDL_GetGamepadButton(pad,11)||SDL_GetGamepadAxis(pad,1)<-18000?"up":SDL_GetGamepadButton(pad,12)||SDL_GetGamepadAxis(pad,1)>18000?"down":SDL_GetGamepadButton(pad,13)||SDL_GetGamepadAxis(pad,0)<-18000?"left":SDL_GetGamepadButton(pad,14)||SDL_GetGamepadAxis(pad,0)>18000?"right":"";if(direction.Length==0){held="";return;}var now=Environment.TickCount64;if(direction!=held){held=direction;nextRepeat=now+350;dispatch(direction);}else if(now>=nextRepeat){nextRepeat=now+120;dispatch(direction);}}
 public void Dispose(){timer.Stop();if(pad!=0)SDL_CloseGamepad(pad);if(ready)SDL_Quit();}
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)][return:MarshalAs(UnmanagedType.I1)]static extern bool SDL_Init(uint flags);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_Quit();
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_PumpEvents();
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_UpdateGamepads();
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern nint SDL_GetGamepads(out int count);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_free(nint p);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern nint SDL_OpenGamepad(uint id);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern void SDL_CloseGamepad(nint pad);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)][return:MarshalAs(UnmanagedType.I1)]static extern bool SDL_GetGamepadButton(nint pad,int button);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)]static extern short SDL_GetGamepadAxis(nint pad,int axis);
}
