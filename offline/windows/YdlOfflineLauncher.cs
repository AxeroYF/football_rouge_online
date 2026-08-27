using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace YdlOfflineLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs args)
            {
                MessageBox.Show(args.Exception.Message, "YDL S4 Offline", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            Application.Run(new LauncherForm());
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly string root;
        private readonly string nodePath;
        private readonly string appDir;
        private readonly string seedDataDir;
        private readonly string seedProfilesDir;
        private readonly string supportDir;
        private string dataDir;
        private string profileDir;
        private string logDir;
        private string stdoutLog;
        private string stderrLog;
        private string pidFile;
        private readonly string settingsPath;
        private readonly string baseUrl = "http://127.0.0.1:4318";

        private readonly Label statusLabel;
        private readonly Label detailLabel;
        private readonly StatusLight statusDot;
        private readonly Button gameButton;
        private readonly Button adminButton;
        private readonly Button serviceButton;
        private readonly Button dataButton;
        private readonly Button logButton;
        private readonly ComboBox saveCombo;
        private readonly Button newSaveButton;
        private readonly Button deleteSaveButton;
        private string activeSaveId = "default";
        private readonly CheckBox attributeUnlockCheck;
        private readonly RadioButton overflow100Button;
        private readonly RadioButton overflow50Button;
        private readonly RadioButton overflow30Button;
        private readonly Timer healthTimer;
        private readonly object logLock = new object();

        private Process serverProcess;
        private StreamWriter stdoutWriter;
        private StreamWriter stderrWriter;
        private bool ownsServer;
        private bool busy;
        private bool closing;
        private bool lastHealthy;

        public LauncherForm()
        {
            root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            nodePath = Path.Combine(root, "runtime", "node.exe");
            appDir = Path.Combine(root, "app");
            seedDataDir = Path.Combine(root, "seed-data");
            seedProfilesDir = Path.Combine(root, "seed-player-profiles");
            supportDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YDL S4 Offline");
            SetActiveSavePaths("default");
            settingsPath = Path.Combine(supportDir, "launcher-settings.ini");

            Text = "YDL S4 Offline v1.2";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(600, 560);
            MinimumSize = new Size(600, 560);
            MaximumSize = new Size(600, 560);
            BackColor = Color.FromArgb(7, 20, 17);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            DoubleBuffered = true;
            Paint += DrawPitchBackground;

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 82;
            header.BackColor = Color.FromArgb(7, 20, 17);
            Controls.Add(header);

            BrandBadge brandBadge = new BrandBadge();
            brandBadge.Location = new Point(28, 15);
            brandBadge.Size = new Size(42, 48);
            header.Controls.Add(brandBadge);

            Panel headerLine = new Panel();
            headerLine.Dock = DockStyle.Bottom;
            headerLine.Height = 1;
            headerLine.BackColor = Color.FromArgb(41, 67, 56);
            header.Controls.Add(headerLine);

            Label title = new Label();
            title.Text = "YDL S4 Offline";
            title.ForeColor = Color.White;
            title.Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(84, 17);
            header.Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "v1.2  ·  S4 离线赛季  ·  Windows x64";
            subtitle.ForeColor = Color.FromArgb(145, 165, 155);
            subtitle.Font = new Font("Microsoft YaHei UI", 9F);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(86, 51);
            header.Controls.Add(subtitle);

            GamePanel statusBand = new GamePanel();
            statusBand.Location = new Point(28, 100);
            statusBand.Size = new Size(544, 66);
            statusBand.BackColor = Color.FromArgb(13, 32, 26);
            statusBand.BorderStyle = BorderStyle.None;
            Controls.Add(statusBand);

            statusDot = new StatusLight();
            statusDot.Location = new Point(18, 21);
            statusDot.Size = new Size(18, 18);
            statusDot.LightColor = Color.FromArgb(255, 128, 93);
            statusBand.Controls.Add(statusDot);

            statusLabel = new Label();
            statusLabel.Text = "正在准备离线服务";
            statusLabel.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
            statusLabel.ForeColor = Color.FromArgb(237, 245, 237);
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(52, 11);
            statusBand.Controls.Add(statusLabel);

            detailLabel = new Label();
            detailLabel.Text = "首次启动会初始化本地存档";
            detailLabel.ForeColor = Color.FromArgb(145, 165, 155);
            detailLabel.AutoSize = true;
            detailLabel.Location = new Point(52, 37);
            statusBand.Controls.Add(detailLabel);
Label saveLabel = new Label();
            saveLabel.Text = "当前存档";
            saveLabel.ForeColor = Color.FromArgb(145, 165, 155);
            saveLabel.AutoSize = true;
            saveLabel.Location = new Point(300, 9);
            statusBand.Controls.Add(saveLabel);
            saveCombo = new ComboBox();
            saveCombo.DropDownStyle = ComboBoxStyle.DropDownList;
            saveCombo.Location = new Point(355, 6);
            saveCombo.Size = new Size(112, 25);
            saveCombo.BackColor = Color.FromArgb(18, 41, 32);
            saveCombo.ForeColor = Color.FromArgb(237, 245, 237);
            saveCombo.FlatStyle = FlatStyle.Flat;
            saveCombo.Enabled = false;
            statusBand.Controls.Add(saveCombo);
            newSaveButton = CreateTinyButton("新建", new Point(300, 37), new Size(80, 22));
            deleteSaveButton = CreateTinyButton("删除", new Point(388, 37), new Size(80, 22));
            statusBand.Controls.Add(newSaveButton);
            statusBand.Controls.Add(deleteSaveButton);
            saveCombo.SelectedIndexChanged += delegate { SaveChoice choice = saveCombo.SelectedItem as SaveChoice; if (choice != null) SwitchSave(choice.Id); };
            newSaveButton.Click += delegate { CreateNewSave(); };
            deleteSaveButton.Click += delegate { DeleteActiveSave(); };

            GamePanel attributePanel = new GamePanel();
            attributePanel.Location = new Point(28, 178);
            attributePanel.Size = new Size(544, 94);
            attributePanel.BackColor = Color.FromArgb(13, 32, 26);
            Controls.Add(attributePanel);

            attributeUnlockCheck = new CheckBox();
            attributeUnlockCheck.Text = "解除球员 99 数值上限";
            attributeUnlockCheck.ForeColor = Color.FromArgb(237, 245, 237);
            attributeUnlockCheck.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
            attributeUnlockCheck.AutoSize = true;
            attributeUnlockCheck.Location = new Point(18, 14);
            attributeUnlockCheck.Cursor = Cursors.Hand;
            attributePanel.Controls.Add(attributeUnlockCheck);

            Label overflowLabel = new Label();
            overflowLabel.Text = "超限部分参与 V2.1 模拟";
            overflowLabel.ForeColor = Color.FromArgb(145, 165, 155);
            overflowLabel.AutoSize = true;
            overflowLabel.Location = new Point(20, 57);
            attributePanel.Controls.Add(overflowLabel);

            overflow100Button = CreateRateButton("100%", new Point(300, 15));
            overflow50Button = CreateRateButton("50%", new Point(374, 15));
            overflow30Button = CreateRateButton("30%", new Point(448, 15));
            attributePanel.Controls.Add(overflow100Button);
            attributePanel.Controls.Add(overflow50Button);
            attributePanel.Controls.Add(overflow30Button);

            Label rateHint = new Label();
            rateHint.Text = "超过 99 的部分按所选比例计入比赛";
            rateHint.ForeColor = Color.FromArgb(108, 129, 119);
            rateHint.AutoSize = true;
            rateHint.Location = new Point(300, 57);
            attributePanel.Controls.Add(rateHint);

            attributeUnlockCheck.CheckedChanged += delegate { SetSettingsEnabled(!lastHealthy && !busy); SaveSettings(); };
            overflow100Button.CheckedChanged += delegate { UpdateRateButtonStyles(); SaveSettings(); };
            overflow50Button.CheckedChanged += delegate { UpdateRateButtonStyles(); SaveSettings(); };
            overflow30Button.CheckedChanged += delegate { UpdateRateButtonStyles(); SaveSettings(); };

            gameButton = CreatePrimaryButton("进入游戏", new Point(28, 288), new Size(264, 64));
            gameButton.Click += delegate { OpenUrl(baseUrl + "/versus/"); };
            Controls.Add(gameButton);

            adminButton = CreatePrimaryButton("进入后台", new Point(308, 288), new Size(264, 64));
            adminButton.BackColor = Color.FromArgb(113, 217, 208);
            adminButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(139, 232, 224);
            adminButton.Click += delegate { OpenUrl(baseUrl + "/admin/"); };
            Controls.Add(adminButton);

            Label passwordLabel = new Label();
            passwordLabel.Text = "后台密码：ydl-offline";
            passwordLabel.ForeColor = Color.FromArgb(145, 165, 155);
            passwordLabel.AutoSize = true;
            passwordLabel.Location = new Point(432, 361);
            Controls.Add(passwordLabel);

            dataButton = CreateSecondaryButton("打开存档", new Point(28, 398), new Size(166, 44));
            dataButton.Click += delegate { OpenFolder(Path.GetDirectoryName(dataDir)); };
            Controls.Add(dataButton);

            logButton = CreateSecondaryButton("查看日志", new Point(210, 398), new Size(166, 44));
            logButton.Click += delegate { OpenFolder(logDir); };
            Controls.Add(logButton);

            serviceButton = CreateSecondaryButton("停止服务", new Point(392, 398), new Size(180, 44));
            serviceButton.Click += async delegate
            {
                if (busy) return;
                if (lastHealthy)
                {
                    StopServer();
                    SetReady(false, "服务已停止", "点击“启动服务”可重新启动");
                }
                else
                {
                    await EnsureServerAsync();
                }
            };
            Controls.Add(serviceButton);

            Label footer = new Label();
            footer.Text = "所有数据仅保存在本机  ·  服务地址 127.0.0.1:4318";
            footer.ForeColor = Color.FromArgb(108, 129, 119);
            footer.AutoSize = true;
            footer.Location = new Point(29, 520);
            Controls.Add(footer);

            healthTimer = new Timer();
            healthTimer.Interval = 2500;
            healthTimer.Tick += async delegate
            {
                if (busy || closing) return;
                bool ready = await Task.Run(new Func<bool>(IsOfflineHealthy));
                lastHealthy = ready;
                if (ready != gameButton.Enabled) SetReady(ready, ready ? "离线服务运行中" : "离线服务未运行", ready ? "可进入游戏或后台" : "点击“启动服务”重新启动");
            };

            FormClosing += OnFormClosing;
            Shown += async delegate
            {
                LoadSettings();
                LoadSaveCatalog();
                bool ready = await Task.Run(new Func<bool>(IsOfflineHealthy));
                lastHealthy = ready;
                SetReady(ready, ready ? "离线服务运行中" : "启动设置已就绪", ready ? "可进入游戏或后台" : "选择规则后点击“启动服务”");
                healthTimer.Start();
            };
        }

        private sealed class SaveChoice
        {
            public string Id;
            public string Label;
            public override string ToString() { return Label; }
        }

        private void SetActiveSavePaths(string id)
        {
            activeSaveId = String.IsNullOrWhiteSpace(id) ? "default" : id;
            string saveRoot = activeSaveId == "default" ? supportDir : Path.Combine(supportDir, "saves", activeSaveId);
            dataDir = Path.Combine(saveRoot, "data");
            profileDir = Path.Combine(supportDir, "player_profiles");
            logDir = Path.Combine(saveRoot, "logs");
            stdoutLog = Path.Combine(logDir, "server.stdout.log");
            stderrLog = Path.Combine(logDir, "server.stderr.log");
            pidFile = Path.Combine(saveRoot, "server.pid");
        }

        private void LoadSaveCatalog()
        {
            try
            {
                Directory.CreateDirectory(Path.Combine(supportDir, "saves"));
                saveCombo.Items.Clear();
                saveCombo.Items.Add(new SaveChoice { Id = "default", Label = "默认存档" });
                foreach (string dir in Directory.GetDirectories(Path.Combine(supportDir, "saves")))
                {
                    string id = Path.GetFileName(dir);
                    if (String.IsNullOrWhiteSpace(id)) continue;
                    saveCombo.Items.Add(new SaveChoice { Id = id, Label = id });
                }
                saveCombo.SelectedItem = saveCombo.Items.Cast<SaveChoice>().FirstOrDefault((choice) => choice.Id == activeSaveId) ?? saveCombo.Items[0];
                saveCombo.Enabled = !lastHealthy && !busy;
                SaveChoice selectedSave = saveCombo.SelectedItem as SaveChoice;
                deleteSaveButton.Enabled = selectedSave != null && selectedSave.Id != "default" && !lastHealthy && !busy;
                newSaveButton.Enabled = !lastHealthy && !busy;
            }
            catch { }
        }

        private void SwitchSave(string id)
        {
            if (busy || lastHealthy || String.Equals(id, activeSaveId, StringComparison.OrdinalIgnoreCase)) return;
            SetActiveSavePaths(id);
            SaveSettings();
            deleteSaveButton.Enabled = id != "default";
            SetReady(false, "存档已切换", "点击“启动服务”载入当前存档");
        }

        private void CreateNewSave()
        {
            if (busy || lastHealthy) return;
            string id = "存档-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
            string target = Path.Combine(supportDir, "saves", id);
            Directory.CreateDirectory(Path.Combine(supportDir, "saves"));
            CopyDirectory(seedDataDir, Path.Combine(target, "data"));
            File.WriteAllText(Path.Combine(target, "data", ".ydl-offline-ready"), DateTime.UtcNow.ToString("o"), Encoding.ASCII);
            SetActiveSavePaths(id);
            LoadSaveCatalog();
            SetReady(false, "已新建存档", "点击“启动服务”开始新的球队生涯");
        }

        private void DeleteActiveSave()
        {
            if (busy || lastHealthy || activeSaveId == "default") return;
            DialogResult result = MessageBox.Show("确定删除当前存档？该存档数据将被永久删除。", "YDL S4 Offline", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (result != DialogResult.Yes) return;
            string target = Path.Combine(supportDir, "saves", activeSaveId);
            if (Directory.Exists(target)) Directory.Delete(target, true);
            SetActiveSavePaths("default");
            LoadSaveCatalog();
            SetReady(false, "存档已删除", "请选择存档后点击“启动服务”");
        }

        private static Button CreateTinyButton(string text, Point location, Size size)
        {
            Button button = CreateSecondaryButton(text, location, size);
            button.Font = new Font("Microsoft YaHei UI", 8F, FontStyle.Bold);
            return button;
        }
        private static Button CreatePrimaryButton(string text, Point location, Size size)
        {
            Button button = new Button();
            button.Text = text;
            button.Location = location;
            button.Size = size;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.BackColor = Color.FromArgb(201, 240, 92);
            button.ForeColor = Color.FromArgb(7, 20, 17);
            button.Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold);
            button.Cursor = Cursors.Hand;
            button.Enabled = false;
            button.FlatAppearance.BorderColor = Color.FromArgb(201, 240, 92);
            return button;
        }

        private static Button CreateSecondaryButton(string text, Point location, Size size)
        {
            Button button = new Button();
            button.Text = text;
            button.Location = location;
            button.Size = size;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(41, 67, 56);
            button.FlatAppearance.BorderSize = 1;
            button.BackColor = Color.FromArgb(18, 41, 32);
            button.ForeColor = Color.FromArgb(237, 245, 237);
            button.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold);
            button.Cursor = Cursors.Hand;
            return button;
        }

        private static RadioButton CreateRateButton(string text, Point location)
        {
            RadioButton button = new RadioButton();
            button.Text = text;
            button.Location = location;
            button.Size = new Size(68, 32);
            button.Appearance = Appearance.Button;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = Color.FromArgb(41, 67, 56);
            button.BackColor = Color.FromArgb(18, 41, 32);
            button.ForeColor = Color.FromArgb(237, 245, 237);
            button.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold);
            button.TextAlign = ContentAlignment.MiddleCenter;
            button.Cursor = Cursors.Hand;
            return button;
        }

        private double SelectedOverflowRate()
        {
            if (overflow30Button.Checked) return 0.3;
            if (overflow50Button.Checked) return 0.5;
            return 1.0;
        }

        private void LoadSettings()
        {
            bool unlocked = false;
            double rate = 1.0;
            try
            {
                if (File.Exists(settingsPath))
                {
                    foreach (string line in File.ReadAllLines(settingsPath, Encoding.UTF8))
                    {
                        string[] parts = line.Split(new char[] { '=' }, 2);
                        if (parts.Length != 2) continue;
                        if (parts[0] == "attributeUncap") unlocked = parts[1] == "1";
                        if (parts[0] == "overflowRate") Double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out rate);
                        if (parts[0] == "activeSaveId" && !String.IsNullOrWhiteSpace(parts[1])) SetActiveSavePaths(parts[1]);
                    }
                }
            }
            catch { }
            attributeUnlockCheck.Checked = unlocked;
            overflow100Button.Checked = rate != 0.5 && rate != 0.3;
            overflow50Button.Checked = rate == 0.5;
            overflow30Button.Checked = rate == 0.3;
            UpdateRateButtonStyles();
            SetSettingsEnabled(!lastHealthy);
        }

        private void SaveSettings()
        {
            try
            {
                Directory.CreateDirectory(supportDir);
                File.WriteAllLines(settingsPath, new string[] {
                    "attributeUncap=" + (attributeUnlockCheck.Checked ? "1" : "0"),
                    "overflowRate=" + SelectedOverflowRate().ToString("0.0", CultureInfo.InvariantCulture),
                    "activeSaveId=" + activeSaveId,
                }, new UTF8Encoding(false));
            }
            catch { }
        }

        private void SetSettingsEnabled(bool enabled)
        {
            attributeUnlockCheck.Enabled = enabled;
            bool rateEnabled = enabled && attributeUnlockCheck.Checked;
            overflow100Button.Enabled = rateEnabled;
            overflow50Button.Enabled = rateEnabled;
            overflow30Button.Enabled = rateEnabled;
            UpdateRateButtonStyles();
        }

        private void UpdateRateButtonStyles()
        {
            foreach (RadioButton button in new RadioButton[] { overflow100Button, overflow50Button, overflow30Button })
            {
                button.BackColor = button.Checked ? Color.FromArgb(201, 240, 92) : Color.FromArgb(18, 41, 32);
                button.ForeColor = button.Checked ? Color.FromArgb(7, 20, 17) : Color.FromArgb(237, 245, 237);
                button.FlatAppearance.BorderColor = button.Checked ? Color.FromArgb(201, 240, 92) : Color.FromArgb(41, 67, 56);
            }
        }

        private async Task EnsureServerAsync()
        {
            if (busy || closing) return;
            busy = true;
            healthTimer.Stop();
            SetBusy("正在准备离线服务", "正在检查运行环境");

            try
            {
                ValidatePackage();
                if (await Task.Run(new Func<bool>(IsOfflineHealthy)))
                {
                    ownsServer = false;
                    SetReady(true, "离线服务运行中", "可进入游戏或后台");
                    return;
                }

                SetBusy("正在初始化存档", "首次启动可能需要几秒钟");
                await Task.Run(new Action(InitializeData));

                SetBusy("正在启动本地服务", "比赛引擎和球员数据库正在载入");
                StartNodeProcess();

                bool ready = false;
                for (int attempt = 0; attempt < 120; attempt++)
                {
                    if (closing) return;
                    if (serverProcess != null && serverProcess.HasExited) break;
                    if (await Task.Run(new Func<bool>(IsOfflineHealthy)))
                    {
                        ready = true;
                        break;
                    }
                    await Task.Delay(500);
                }

                if (!ready)
                {
                    string error = ReadLogTail(stderrLog, 20);
                    throw new InvalidOperationException("本地服务未能启动。" + (String.IsNullOrWhiteSpace(error) ? "" : Environment.NewLine + error));
                }

                SetReady(true, "离线服务运行中", "请选择进入游戏或后台");
            }
            catch (Exception error)
            {
                StopServer();
                SetReady(false, "启动失败", "可点击“查看日志”检查详细信息");
                MessageBox.Show(error.Message, "YDL S4 Offline 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                busy = false;
                if (!closing) healthTimer.Start();
            }
        }

        private void ValidatePackage()
        {
            if (!File.Exists(nodePath)) throw new FileNotFoundException("离线版文件不完整：缺少 runtime\\node.exe");
            if (!File.Exists(Path.Combine(appDir, "devtool", "public-server.js"))) throw new FileNotFoundException("离线版文件不完整：缺少游戏服务入口");
            if (!Directory.Exists(seedDataDir)) throw new DirectoryNotFoundException("离线版文件不完整：缺少 seed-data");
            if (!Directory.Exists(seedProfilesDir)) throw new DirectoryNotFoundException("离线版文件不完整：缺少 seed-player-profiles");
        }

        private void InitializeData()
        {
            Directory.CreateDirectory(supportDir);
            Directory.CreateDirectory(logDir);

            if (!IsDataComplete(dataDir))
            {
                PreserveIncompleteDirectory(dataDir, "data-incomplete");
                string stagingData = Path.Combine(supportDir, "data-initializing-" + Guid.NewGuid().ToString("N"));
                CopyDirectory(seedDataDir, stagingData);
                if (!HasRequiredDataFiles(stagingData)) throw new InvalidDataException("包内离线赛季数据不完整。");
                File.WriteAllText(Path.Combine(stagingData, ".ydl-offline-ready"), DateTime.UtcNow.ToString("o"), Encoding.ASCII);
                if (!IsDataComplete(stagingData)) throw new InvalidDataException("离线赛季数据初始化未完成。");
                Directory.Move(stagingData, dataDir);
            }

            RepairExistingOfflineData();

            if (!AreProfilesComplete(profileDir))
            {
                PreserveIncompleteDirectory(profileDir, "player-profiles-incomplete");
                string stagingProfiles = Path.Combine(supportDir, "player-profiles-initializing-" + Guid.NewGuid().ToString("N"));
                CopyDirectory(seedProfilesDir, stagingProfiles);
                if (!AreProfilesComplete(stagingProfiles)) throw new InvalidDataException("包内球员图片不完整。");
                Directory.Move(stagingProfiles, profileDir);
            }
        }

        private void RepairExistingOfflineData()
        {
            string script = Path.Combine(appDir, "offline", "repair-offline-seed.mjs");
            if (!File.Exists(script) || !IsDataComplete(dataDir)) return;

            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = nodePath;
            info.Arguments = QuoteArgument(script) + " " + QuoteArgument(dataDir);
            info.WorkingDirectory = appDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;

            using (Process repair = Process.Start(info))
            {
                string output = repair.StandardOutput.ReadToEnd();
                string error = repair.StandardError.ReadToEnd();
                repair.WaitForExit();
                if (repair.ExitCode != 0)
                {
                    throw new InvalidDataException("现有离线存档自动修复失败。" + Environment.NewLine + error + Environment.NewLine + output);
                }
            }
        }
        private static bool IsDataComplete(string candidateRoot)
        {
            return File.Exists(Path.Combine(candidateRoot, ".ydl-offline-ready"))
                && HasRequiredDataFiles(candidateRoot);
        }

        private static bool HasRequiredDataFiles(string candidateRoot)
        {
            return File.Exists(Path.Combine(candidateRoot, "OFFLINE_MIGRATION_REPORT.json"))
                && File.Exists(Path.Combine(candidateRoot, "versus-accounts.json"))
                && File.Exists(Path.Combine(candidateRoot, "yellowdogs-league-shards", "manifest.json"))
                && File.Exists(Path.Combine(candidateRoot, "yellowdogs-league-shards", "revisions", "2", "core.json"))
                && File.Exists(Path.Combine(candidateRoot, "yellowdogs-league-shards", "revisions", "1", "matches-index.json"));
        }

        private bool AreProfilesComplete(string candidateRoot)
        {
            if (!Directory.Exists(candidateRoot)) return false;
            foreach (string source in Directory.GetFiles(seedProfilesDir, "*", SearchOption.AllDirectories))
            {
                string relative = source.Substring(seedProfilesDir.Length).TrimStart(Path.DirectorySeparatorChar);
                string target = Path.Combine(candidateRoot, relative);
                if (!File.Exists(target) || new FileInfo(target).Length != new FileInfo(source).Length) return false;
            }
            return true;
        }

        private void PreserveIncompleteDirectory(string path, string prefix)
        {
            if (!Directory.Exists(path)) return;
            string timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            string recovery = Path.Combine(supportDir, prefix + "-" + timestamp);
            int suffix = 1;
            while (Directory.Exists(recovery))
            {
                recovery = Path.Combine(supportDir, prefix + "-" + timestamp + "-" + suffix.ToString());
                suffix++;
            }
            Directory.Move(path, recovery);
        }

        private void StartNodeProcess()
        {
            Directory.CreateDirectory(logDir);
            CloseLogWriters();
            stdoutWriter = new StreamWriter(stdoutLog, false, new UTF8Encoding(false));
            stderrWriter = new StreamWriter(stderrLog, false, new UTF8Encoding(false));
            stdoutWriter.AutoFlush = true;
            stderrWriter.AutoFlush = true;

            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = nodePath;
            info.Arguments = "devtool/public-server.js";
            info.WorkingDirectory = appDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.EnvironmentVariables["YDL_OFFLINE_MODE"] = "1";
            info.EnvironmentVariables["APP_ENV"] = "production";
            info.EnvironmentVariables["APP_LABEL"] = "YDL S4 Offline";
            info.EnvironmentVariables["VERSUS_HOST"] = "127.0.0.1";
            info.EnvironmentVariables["DEVTOOL_PORT"] = "4318";
            info.EnvironmentVariables["VERSUS_ADMIN_PASSWORD"] = "ydl-offline";
            info.EnvironmentVariables["YDL_MATCH_ENGINE"] = "v2";
            info.EnvironmentVariables["YDL_LEAGUE_MATCH_ENGINE"] = "v2";
            info.EnvironmentVariables["YDL_CUP_MATCH_ENGINE"] = "v2";
            SaveSettings();
            info.EnvironmentVariables["YDL_OFFLINE_ATTRIBUTE_UNCAP"] = attributeUnlockCheck.Checked ? "1" : "0";
            info.EnvironmentVariables["YDL_OFFLINE_OVERCAP_RATE"] = SelectedOverflowRate().ToString("0.0", CultureInfo.InvariantCulture);
            info.EnvironmentVariables["YELLOWDOGS_LEAGUE_PATH"] = Path.Combine(dataDir, "yellowdogs-league-shards");
            info.EnvironmentVariables["VERSUS_ACCOUNTS_PATH"] = Path.Combine(dataDir, "versus-accounts.json");
            info.EnvironmentVariables["YDL_CONTENT_OVERRIDES_PATH"] = Path.Combine(dataDir, "ydl-content-overrides.json");
            info.EnvironmentVariables["YDL_PLAYER_CARD_STUDIO_PATH"] = Path.Combine(dataDir, "ydl-player-card-studio.json");
            info.EnvironmentVariables["YDL_PLAYER_PROFILE_ROOT"] = profileDir;

            serverProcess = new Process();
            serverProcess.StartInfo = info;
            serverProcess.EnableRaisingEvents = true;
            serverProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { WriteLog(stdoutWriter, args.Data); };
            serverProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { WriteLog(stderrWriter, args.Data); };
            serverProcess.Exited += delegate
            {
                CloseLogWriters();
                if (!closing && IsHandleCreated)
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        SetReady(false, "服务已停止", "点击“启动服务”可重新启动");
                    });
                }
            };
            if (!serverProcess.Start()) throw new InvalidOperationException("无法启动内置 Node.js。");
            ownsServer = true;
            File.WriteAllText(pidFile, serverProcess.Id.ToString(), Encoding.ASCII);
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();
        }

        private bool IsOfflineHealthy()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/health");
                request.Method = "GET";
                request.Timeout = 1500;
                request.ReadWriteTimeout = 1500;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    return reader.ReadToEnd().IndexOf("\"offlineYdl\":true", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private void StopServer()
        {
            healthTimer.Stop();
            try
            {
                Process target = serverProcess;
                if (target == null || target.HasExited) target = FindPidProcess();
                if (target != null && !target.HasExited)
                {
                    target.Kill();
                    target.WaitForExit(5000);
                }
            }
            catch { }
            finally
            {
                ownsServer = false;
                serverProcess = null;
                TryDelete(pidFile);
                CloseLogWriters();
                if (!closing) healthTimer.Start();
            }
        }

        private Process FindPidProcess()
        {
            try
            {
                if (!File.Exists(pidFile)) return null;
                int pid;
                if (!Int32.TryParse(File.ReadAllText(pidFile).Trim(), out pid)) return null;
                Process process = Process.GetProcessById(pid);
                string executable = process.MainModule == null ? "" : process.MainModule.FileName;
                return String.Equals(Path.GetFullPath(executable), Path.GetFullPath(nodePath), StringComparison.OrdinalIgnoreCase) ? process : null;
            }
            catch
            {
                return null;
            }
        }

        private void SetBusy(string status, string detail)
        {
            statusDot.LightColor = Color.FromArgb(255, 128, 93);
            statusLabel.Text = status;
            detailLabel.Text = detail;
            gameButton.Enabled = false;
            adminButton.Enabled = false;
            serviceButton.Enabled = false;
            serviceButton.Text = "正在启动";
            SetSettingsEnabled(false);
            if (saveCombo != null) { saveCombo.Enabled = false; newSaveButton.Enabled = false; deleteSaveButton.Enabled = false; }
        }

        private void SetReady(bool ready, string status, string detail)
        {
            lastHealthy = ready;
            statusDot.LightColor = ready ? Color.FromArgb(201, 240, 92) : Color.FromArgb(255, 89, 100);
            statusLabel.Text = status;
            detailLabel.Text = detail;
            gameButton.Enabled = ready;
            adminButton.Enabled = ready;
            serviceButton.Enabled = true;
            serviceButton.Text = ready ? "停止服务" : "启动服务";
            SetSettingsEnabled(!ready);
            if (saveCombo != null) { saveCombo.Enabled = !ready && !busy; newSaveButton.Enabled = !ready && !busy; deleteSaveButton.Enabled = !ready && !busy && activeSaveId != "default"; }
        }

        private void OpenUrl(string url)
        {
            if (!lastHealthy)
            {
                MessageBox.Show("离线服务尚未就绪。", "YDL S4 Offline", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string separator = url.IndexOf("?") >= 0 ? "&" : "?";
            string target = url + separator + "save=" + Uri.EscapeDataString(activeSaveId);
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        private static void OpenFolder(string path)
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
        }

        private void DrawPitchBackground(object sender, PaintEventArgs args)
        {
            using (Pen line = new Pen(Color.FromArgb(24, 113, 217, 208), 1F))
            {
                Rectangle field = new Rectangle(12, 86, ClientSize.Width - 24, ClientSize.Height - 104);
                args.Graphics.DrawRectangle(line, field);
                args.Graphics.DrawLine(line, ClientSize.Width / 2, field.Top, ClientSize.Width / 2, field.Bottom);
                args.Graphics.DrawEllipse(line, ClientSize.Width / 2 - 42, field.Top + field.Height / 2 - 42, 84, 84);
            }
        }
        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            closing = true;
            healthTimer.Stop();
            if (ownsServer) StopServer();
        }

        private void WriteLog(StreamWriter writer, string value)
        {
            if (writer == null || value == null) return;
            lock (logLock)
            {
                try { writer.WriteLine(value); } catch { }
            }
        }

        private void CloseLogWriters()
        {
            lock (logLock)
            {
                try { if (stdoutWriter != null) stdoutWriter.Dispose(); } catch { }
                try { if (stderrWriter != null) stderrWriter.Dispose(); } catch { }
                stdoutWriter = null;
                stderrWriter = null;
            }
        }

        private static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "robocopy.exe");
            info.Arguments = QuoteArgument(source) + " " + QuoteArgument(destination) + " /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP";
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;

            using (Process copy = Process.Start(info))
            {
                string output = copy.StandardOutput.ReadToEnd();
                string error = copy.StandardError.ReadToEnd();
                copy.WaitForExit();
                if (copy.ExitCode >= 8)
                {
                    throw new IOException("离线数据复制失败（robocopy " + copy.ExitCode.ToString() + "）。" + Environment.NewLine + error + Environment.NewLine + output);
                }
            }
        }

        private static string QuoteArgument(string value)
        {
            if (value.IndexOf('"') >= 0) throw new ArgumentException("路径中有非法字符。");
            return "\"" + value + "\"";
        }

        private static string ReadLogTail(string path, int lineCount)
        {
            try
            {
                if (!File.Exists(path)) return "";
                string[] lines = File.ReadAllLines(path, Encoding.UTF8);
                int start = Math.Max(0, lines.Length - lineCount);
                return String.Join(Environment.NewLine, lines, start, lines.Length - start);
            }
            catch
            {
                return "";
            }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
    internal sealed class GamePanel : Panel
    {
        public GamePanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            using (Pen line = new Pen(Color.FromArgb(41, 67, 56)))
            {
                args.Graphics.DrawRectangle(line, 0, 0, Width - 1, Height - 1);
            }
        }
    }

    internal sealed class StatusLight : Control
    {
        private Color lightColor = Color.FromArgb(255, 128, 93);
        public Color LightColor
        {
            get { return lightColor; }
            set { lightColor = value; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs args)
        {
            args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (SolidBrush glow = new SolidBrush(Color.FromArgb(48, lightColor)))
            using (SolidBrush core = new SolidBrush(lightColor))
            {
                args.Graphics.FillEllipse(glow, 0, 0, Width - 1, Height - 1);
                args.Graphics.FillEllipse(core, 4, 4, Width - 9, Height - 9);
            }
        }
    }

    internal sealed class BrandBadge : Control
    {
        protected override void OnPaint(PaintEventArgs args)
        {
            args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            PointF[] shield = new PointF[] {
                new PointF(4, 0), new PointF(38, 0), new PointF(42, 35),
                new PointF(21, 48), new PointF(0, 35)
            };
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(201, 240, 92)))
            using (SolidBrush ink = new SolidBrush(Color.FromArgb(7, 20, 17)))
            using (Font font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold))
            {
                args.Graphics.FillPolygon(fill, shield);
                StringFormat format = new StringFormat();
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                args.Graphics.DrawString("YDL", font, ink, new RectangleF(0, 0, 42, 40), format);
                format.Dispose();
            }
        }
    }
}
