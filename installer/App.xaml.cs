using System.IO;
using System.Text.Json;
using System.Windows;
namespace PssSetup;
public partial class App:Application {
 protected override async void OnStartup(StartupEventArgs e) {
  base.OnStartup(e);
  try {
   var options=SetupOptions.Parse(e.Args);
   if(options.Uninstall&&!options.TempUninstaller&&!options.Preview&&Environment.ProcessPath!.StartsWith(options.Destination+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)){SetupEngine.StartTemporaryUninstaller(options);Shutdown();return;}
   if(options.Silent){var result=options.Uninstall?await SetupEngine.Uninstall(options,_=>{}):await SetupEngine.Install(options,_=>{});if(options.Report.Length>0)await File.WriteAllTextAsync(options.Report,JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true}));Shutdown(result.Success?0:1);return;}
   var window=new MainWindow(options);MainWindow=window;window.Show();
  }catch(Exception ex){var failure=new MainWindow(new SetupOptions());MainWindow=failure;failure.Show();failure.ShowError(ex.Message);}
 }
}
