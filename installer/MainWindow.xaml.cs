using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
namespace PssSetup;

public partial class MainWindow:Window {
 readonly SetupOptions options;
 readonly Dictionary<string,MediaPlayer> sounds=new();
 readonly string audioFolder=Path.Combine(Path.GetTempPath(),"PSS-Setup-Audio-"+Guid.NewGuid().ToString("N"));
 string page="welcome";
 bool busy;
 long lastMove;
 SetupController? controller;
 public MainWindow(SetupOptions options){
  this.options=options;InitializeComponent();DestinationBox.Text=options.Destination;JellyfinBox.Text=options.Jellyfin;StartupCheck.IsChecked=options.Startup;ShortcutCheck.IsChecked=options.Shortcut;SoundCheck.IsChecked=options.Sounds;MotionCheck.IsChecked=options.ReducedMotion;
  var manifest=SetupEngine.Manifest();StorageText.Text=manifest==null?"PSS Console • Windows 11 x64":"PSS Console 1.1 • "+Math.Ceiling(manifest.UncompressedBytes/1024d/1024)+" MB installed • Windows x64";
  if(!options.Preview){PrepareSounds();controller=new SetupController(()=>IsActive&&!busy,ControllerInput);FooterHint.Text="× / A  Select     ○ / B  Back     ENTER  Continue";}
  Loaded+=async(_,_)=>{ShowPage(options.Uninstall?"uninstall":options.Preview?options.PreviewPage:"welcome");if(options.CaptureDirectory.Length>0){await CaptureAll();Close();}else if(!options.Preview)Play("Startup");};
 }
 void PrepareSounds(){Directory.CreateDirectory(audioFolder);foreach(var cue in new[]{"Move","Select","Back","Startup"}){using var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("Sound."+cue+".wav");if(input==null)continue;var file=Path.Combine(audioFolder,cue+".wav");using(var output=File.Create(file))input.CopyTo(output);var player=new MediaPlayer{Volume=.25};player.Open(new Uri(file));sounds[cue]=player;}}
 void Play(string cue){if(options.Preview||SoundCheck?.IsChecked==false)return;if(cue=="Move"){if(Environment.TickCount64-lastMove<70)return;lastMove=Environment.TickCount64;}if(sounds.TryGetValue(cue,out var sound)){sound.Position=TimeSpan.Zero;sound.Play();}}
 void ShowPage(string next){
  page=next;foreach(var panel in new[]{WelcomePanel,LocationPanel,PreferencesPanel,ReviewPanel,ProgressPanel,CompletePanel,UninstallPanel,ErrorPanel})panel.Visibility=Visibility.Collapsed;
  var scene=next switch{"location"=>LocationPanel,"preferences"=>PreferencesPanel,"review"=>ReviewPanel,"install"=>ProgressPanel,"complete"=>CompletePanel,"uninstall"=>UninstallPanel,"error"=>ErrorPanel,_=>WelcomePanel};scene.Visibility=Visibility.Visible;
  NextButton.Content=next switch{"welcome"=>"Get started","review"=>"Install console","complete"=>options.Uninstall?"Return to Windows":"Enter console","uninstall"=>"Remove console","error"=>"Try again",_=>"Continue"};
  NextButton.Visibility=next=="install"?Visibility.Collapsed:Visibility.Visible;BackButton.Visibility=next=="install"?Visibility.Collapsed:Visibility.Visible;BackButton.Content=next=="welcome"?"Return to Windows":next=="complete"?"Close":next=="uninstall"?"Keep console":"Back";
  var number=next switch{"location"=>2,"preferences"=>3,"review"=>4,"install"=>5,"complete"=>6,_=>1};StepText.Text=options.Uninstall?"PSS CONSOLE":number.ToString("00")+" / 06";FooterHint.Visibility=next=="install"?Visibility.Collapsed:Visibility.Visible;HeaderLabel.Text=options.Uninstall?"CONSOLE REMOVAL":"CONSOLE SETUP";
  if(next=="review")ReviewText.Text="Install to\n"+DestinationBox.Text+"\n\n"+(StartupCheck.IsChecked==true?"✓  Start at Windows sign-in":"○  Start manually")+"\n"+(ShortcutCheck.IsChecked==true?"✓  Desktop shortcut":"○  No desktop shortcut")+"\n"+(SoundCheck.IsChecked==true?"✓  PS5 sounds and SST typography":"✓  SST typography, silent interface");
  if(MotionCheck.IsChecked!=true&&!options.Preview)scene.BeginAnimation(OpacityProperty,new DoubleAnimation(0,1,TimeSpan.FromMilliseconds(150)));else scene.Opacity=1;
  Dispatcher.BeginInvoke(()=>{if(next is "location")DestinationBox.Focus();else if(next is "preferences")StartupCheck.Focus();else NextButton.Focus();},DispatcherPriority.Input);
 }
 void ReadOptions(){options.Destination=SetupEngine.ValidateDestination(DestinationBox.Text);options.Startup=StartupCheck.IsChecked==true;options.Shortcut=ShortcutCheck.IsChecked==true;options.Sounds=SoundCheck.IsChecked==true;options.ReducedMotion=MotionCheck.IsChecked==true;options.KeepData=KeepDataCheck.IsChecked==true;options.Jellyfin=JellyfinBox.Text.Trim();if(!Uri.TryCreate(options.Jellyfin,UriKind.Absolute,out var uri)||uri.Scheme is not("http" or "https"))throw new InvalidOperationException("Use an http:// or https:// Jellyfin address.");}
 async void GoNext(object sender,RoutedEventArgs e){
  if(busy)return;
  if(options.Preview){ShowPage(page switch{"welcome"=>"location","location"=>"preferences","preferences"=>"review","review"=>"install","install"=>"complete",_=>"welcome"});return;}
  try{
   if(page=="welcome"){ShowPage("location");return;}
   if(page=="location"){options.Destination=SetupEngine.ValidateDestination(DestinationBox.Text);ShowPage("preferences");return;}
   if(page=="preferences"){ReadOptions();ShowPage("review");return;}
   if(page=="review"||page=="uninstall"){ReadOptions();busy=true;CloseButton.IsEnabled=false;ShowPage("install");if(options.Uninstall)ProgressHeading.Text="Returning to Windows.";double last=-1;IProgress<SetupProgress> progress=new Progress<SetupProgress>(p=>{if(p.Percent-last<.4&&p.Percent<100)return;last=p.Percent;ProgressLabel.Text=p.Stage;PercentText.Text=Math.Clamp(p.Percent,0,100).ToString("0")+"%";ProgressFill.Width=Math.Max(0,ProgressPanel.ActualWidth*p.Percent/100);});var result=options.Uninstall?await SetupEngine.Uninstall(options,p=>progress.Report(p)):await SetupEngine.Install(options,p=>progress.Report(p));busy=false;CloseButton.IsEnabled=true;if(!result.Success){ShowError(result.Error??"Setup couldn't finish.");return;}if(options.Uninstall){CompleteHeading.Text="You're back in Windows.";CompleteText.Text="PSS removed. Your games and media stay with you.";}ShowPage("complete");Play("Select");return;}
   if(page=="complete"){if(!options.Uninstall){var target=Path.Combine(options.Destination,"PSS Console.exe");Process.Start(new ProcessStartInfo(target){WorkingDirectory=options.Destination,UseShellExecute=true});}Close();return;}
   if(page=="error")ShowPage(options.Uninstall?"uninstall":"location");
  }catch(Exception ex){busy=false;CloseButton.IsEnabled=true;ShowError(ex.Message);}
 }
 void GoBack(object sender,RoutedEventArgs e){if(busy)return;Play("Back");switch(page){case "location":ShowPage("welcome");break;case "preferences":ShowPage("location");break;case "review":ShowPage("preferences");break;case "error":ShowPage(options.Uninstall?"uninstall":"location");break;default:Close();break;}}
 public void ShowError(string message){ErrorIntro.Text=options.Uninstall?"Console removal couldn’t finish. Close PSS and try again.":"Setup couldn’t finish. Your existing installation is preserved.";ErrorText.Text=message;ShowPage("error");}
 void Minimize(object sender,RoutedEventArgs e)=>WindowState=WindowState.Minimized;
 void ControllerInput(string action){if(action=="back"){GoBack(this,new RoutedEventArgs());return;}if(action=="confirm"){Play("Select");if(Keyboard.FocusedElement is Button button)button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));else if(Keyboard.FocusedElement is CheckBox check)check.IsChecked=check.IsChecked!=true;else GoNext(this,new RoutedEventArgs());return;}var direction=action switch{"up"=>FocusNavigationDirection.Up,"down"=>FocusNavigationDirection.Down,"left"=>FocusNavigationDirection.Left,_=>FocusNavigationDirection.Right};if(Keyboard.FocusedElement is UIElement element)element.MoveFocus(new TraversalRequest(direction));}
 void CloseSetup(object sender,RoutedEventArgs e){if(!busy)Close();}
 void OnDrag(object sender,MouseButtonEventArgs e){if(e.ChangedButton==MouseButton.Left&&e.ButtonState==MouseButtonState.Pressed)try{DragMove();}catch{}}
 void OnPointer(object sender,MouseButtonEventArgs e){var node=e.OriginalSource as DependencyObject;while(node!=null&&node is not Button&&node is not CheckBox)node=VisualTreeHelper.GetParent(node);if(node is Button button)Play(button==BackButton||button==CloseButton?"Back":"Select");if(node is CheckBox)Play("Select");}
 void OnFocus(object sender,KeyboardFocusChangedEventArgs e){if(e.NewFocus is Button or CheckBox or TextBox)Play("Move");}
 void OnKeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Escape&&!busy){e.Handled=true;GoBack(sender,new RoutedEventArgs());}else if(e.Key==Key.Enter&&e.OriginalSource is not Button&&!busy){e.Handled=true;Play("Select");GoNext(sender,new RoutedEventArgs());}else if(e.Key is Key.Up or Key.Down or Key.Left or Key.Right&&e.OriginalSource is not TextBox){var direction=e.Key switch{Key.Up=>FocusNavigationDirection.Up,Key.Down=>FocusNavigationDirection.Down,Key.Left=>FocusNavigationDirection.Left,_=>FocusNavigationDirection.Right};if(Keyboard.FocusedElement is UIElement element){element.MoveFocus(new TraversalRequest(direction));e.Handled=true;}}}
 void OnClosing(object? sender,CancelEventArgs e){if(busy){e.Cancel=true;return;}controller?.Dispose();foreach(var sound in sounds.Values)sound.Close();try{if(Directory.Exists(audioFolder))Directory.Delete(audioFolder,true);}catch{}}
 async Task CaptureAll(){Directory.CreateDirectory(options.CaptureDirectory);foreach(var name in new[]{"welcome","location","preferences","review","install","complete","uninstall","error"}){if(name=="install"){ProgressLabel.Text="Installing your console…";PercentText.Text="64%";ProgressFill.Width=600;}if(name=="error")ErrorText.Text="Choose an empty folder or your existing PSS installation, then try again.";ShowPage(name);await Task.Delay(150);await Dispatcher.InvokeAsync(()=>{},DispatcherPriority.Render);var root=(FrameworkElement)Content;var image=new RenderTargetBitmap((int)root.ActualWidth,(int)root.ActualHeight,96,96,PixelFormats.Pbgra32);image.Render(root);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(image));using var stream=File.Create(Path.Combine(options.CaptureDirectory,"PSS-Setup-"+name+".png"));encoder.Save(stream);}}
}
