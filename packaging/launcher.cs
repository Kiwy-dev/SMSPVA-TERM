using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string[] candidates = new[]
        {
            Path.Combine(baseDir, "Start-SMSPVA.ps1"),
            Path.Combine(userProfile, "Proyectos", "SMSPVA-TERM", "Start-SMSPVA.ps1"),
            @"C:\Users\cesrl\Proyectos\SMSPVA-TERM\Start-SMSPVA.ps1"
        };

        string scriptPath = null;
        foreach (string c in candidates)
        {
            if (File.Exists(c))
            {
                scriptPath = c;
                break;
            }
        }

        if (scriptPath == null)
        {
            MessageBox.Show(
                "No se encontró Start-SMSPVA.ps1 en la carpeta actual ni en Proyectos\\SMSPVA-TERM.",
                "SMSPVA",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        string psExe = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe"
        );
        if (!File.Exists(psExe)) psExe = "powershell.exe";

        ProcessStartInfo psi = new ProcessStartInfo
        {
            FileName = psExe,
            Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
            WorkingDirectory = Path.GetDirectoryName(scriptPath),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        Process.Start(psi);
    }
}
