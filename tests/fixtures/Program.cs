using System.Text.Json;
namespace PssProbe;
static class Program {
 [STAThread] static void Main(string[] args) {
  Application.EnableVisualStyles();
  using var window=new Form {Text="PSS Standalone Probe",Width=700,Height=350,StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(16,29,45),ForeColor=Color.White};
  window.Controls.Add(new Label {Text="PSS standalone launch check\nTemporary test window. No game files modified.",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",20)});
  window.Shown+=(_,_)=>{var index=Array.IndexOf(args,"--report");if(index>=0&&index+1<args.Length)File.WriteAllText(args[index+1],JsonSerializer.Serialize(new {args,cwd=Environment.CurrentDirectory}));};
  Application.Run(window);
 }
}
