using System.Text.Json;
namespace PssProbe;
static class Program {
 [STAThread] static void Main(string[] args) {
  string Value(string flag,string fallback=""){var i=Array.IndexOf(args,flag);return i>=0&&i+1<args.Length?args[i+1]:fallback;}
  if(int.TryParse(Value("--delay"),out var delay))Thread.Sleep(delay);
  Application.EnableVisualStyles();
  if(args.Contains("--error")){MessageBox.Show("Probe runtime unavailable. Update required.","PSS Probe - System Error");return;}
  if(int.TryParse(Value("--splash"),out var splashDelay)) {
   using var splash=new Form {Text="Starting probe",Width=400,Height=220,FormBorderStyle=FormBorderStyle.FixedToolWindow};
   using var splashTimer=new System.Windows.Forms.Timer {Interval=splashDelay};splashTimer.Tick+=(_,_)=>splash.Close();splashTimer.Start();Application.Run(splash);
  }
  using var window=new Form {Text=Value("--title","PSS Standalone Probe"),Width=700,Height=350,StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(16,29,45),ForeColor=Color.White};
  window.Controls.Add(new Label {Text="PSS standalone launch check\nTemporary test window. No game files modified.",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",20)});
  if(args.Contains("--modal-error"))window.Shown+=(_,_)=>window.BeginInvoke(new Action(()=>{MessageBox.Show("Probe runtime unavailable. Update required.","PSS Probe - System Error");window.Close();}));
  window.Shown+=(_,_)=>{var index=Array.IndexOf(args,"--report");if(index>=0&&index+1<args.Length)File.WriteAllText(args[index+1],JsonSerializer.Serialize(new {args,cwd=Environment.CurrentDirectory}));if(args.Contains("--minimized"))window.WindowState=FormWindowState.Minimized;};
  using var commands=new System.Windows.Forms.Timer {Interval=100};
  Form current=window;Form? blocker=null;
  commands.Tick+=(_,_)=>{if(blocker!=null&&!blocker.IsDisposed)blocker.Activate();var file=Value("--commands");if(file.Length==0||!File.Exists(file))return;try{var command=File.ReadAllText(file);File.Delete(file);if(command=="hide")current.Hide();if(command=="show"){current.WindowState=FormWindowState.Normal;current.Show();}if(command=="minimize")current.WindowState=FormWindowState.Minimized;if(command=="disable"){blocker=new Form {Text="Probe authentication required",Width=400,Height=240};blocker.Show(current);current.Enabled=false;blocker.Activate();}if(command=="enable"){blocker?.Close();blocker=null;current.Enabled=true;}if(command=="replace"){var replacement=new Form {Text=window.Text,Width=900,Height=500,BackColor=window.BackColor};current.Hide();replacement.Show();current=replacement;}if(command=="exit"){if(current!=window)current.Close();window.Close();}}catch(IOException){}};
  commands.Start();
  Application.Run(window);
 }
}
