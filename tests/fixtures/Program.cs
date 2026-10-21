using System.Text.Json;
namespace PssProbe;
static class Program {
 [STAThread] static void Main(string[] args) {
  string Value(string flag,string fallback=""){var i=Array.IndexOf(args,flag);return i>=0&&i+1<args.Length?args[i+1]:fallback;}
  if(int.TryParse(Value("--delay"),out var delay))Thread.Sleep(delay);
  Application.EnableVisualStyles();
  using var window=new Form {Text=Value("--title","PSS Standalone Probe"),Width=700,Height=350,StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(16,29,45),ForeColor=Color.White};
  window.Controls.Add(new Label {Text="PSS standalone launch check\nTemporary test window. No game files modified.",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",20)});
  window.Shown+=(_,_)=>{var index=Array.IndexOf(args,"--report");if(index>=0&&index+1<args.Length)File.WriteAllText(args[index+1],JsonSerializer.Serialize(new {args,cwd=Environment.CurrentDirectory}));};
  using var commands=new System.Windows.Forms.Timer {Interval=100};
  commands.Tick+=(_,_)=>{var file=Value("--commands");if(file.Length==0||!File.Exists(file))return;try{var command=File.ReadAllText(file);File.Delete(file);if(command=="hide")window.Hide();if(command=="show")window.Show();if(command=="exit")window.Close();}catch(IOException){}};
  commands.Start();
  Application.Run(window);
 }
}
