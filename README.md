# BrainSync Focus Timer

**English** | [日本語](README.ja.md)

A Pomodoro timer for engineers that estimates brain fatigue

[![Open VSX Version](https://img.shields.io/open-vsx/v/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)
[![Open VSX Rating](https://img.shields.io/open-vsx/rating/donut-service/brainsync-focus-timer)](https://open-vsx.org/extension/donut-service/brainsync-focus-timer)

## Supported Editors

✅ **Visual Studio Code** (1.80.0 or later)
✅ **Cursor** (VS Code based)

BrainSync Focus Timer works in any VS Code compatible editor.

## Features

- 🧠 **30-minute focus + 5-minute break** (customizable: 15–60 minutes)
- 📊 **Automatic brain fatigue score estimation** (calculated from your workload)
- 📈 **Detailed statistics and reports** (daily and weekly)
- 🔗 **Integration with the BrainSync brain fatigue assessment**
- ⚡ **Lightweight and fast** (runs in the background)

<!-- Screenshot: place an image that gives an overview of the extension -->
<!-- ![BrainSync Focus Timer overview](images/screenshots/overview.png) -->

## Usage

### Basic Operation

1. **Start the timer**: click the 🧠 icon in the status bar to open the menu and start the timer
2. **Focus**: work with full concentration for 30 minutes
3. **Take a break**: when the notification arrives, rest for 5 minutes
4. **Check your statistics**: Command Palette > "BrainSync: Show Statistics"

<!-- Screenshot: timer display in the status bar -->
<!-- ![Status bar](images/screenshots/statusbar.png) -->

### Timer Cycle

```
🧠 Work (30 min) → ☕ Short break (5 min) → 🧠 Work → ☕ Break → 🧠 Work → ☕ Break → 🧠 Work → 🌿 Long break (15 min)
```

A long break is inserted after every 4 completed sessions.

### Commands

| Command | Description |
|---------|-------------|
| `BrainSync: Start Timer` | Start the timer |
| `BrainSync: Pause/Resume Timer` | Pause or resume |
| `BrainSync: Reset Timer` | Reset the timer |
| `BrainSync: Skip Break` | Skip the break and start working |
| `BrainSync: Show Statistics` | Open the statistics view |
| `BrainSync: Take Brain Fatigue Assessment` | Open the assessment page |
| `BrainSync: Export Data` | Save your data as CSV |
| `BrainSync: Reset Statistics` | Clear statistics data |
| `BrainSync: Disable Do Not Disturb` | Manually turn off the work-session notification suppression (Do Not Disturb) |
| `BrainSync: Connect Slack` | Register a Slack token and enable the integration |
| `BrainSync: Disconnect Slack` | Disable the Slack integration and delete the token |
| `BrainSync: Settings` | Open the settings view |

### Recommended Keyboard Shortcuts

No shortcuts are bound by default. We recommend the following:

```json
{
  "command": "brainsync.startTimer",
  "key": "ctrl+alt+s",
  "mac": "cmd+alt+s"
},
{
  "command": "brainsync.pauseTimer",
  "key": "ctrl+alt+p",
  "mac": "cmd+alt+p"
},
{
  "command": "brainsync.viewStats",
  "key": "ctrl+alt+t",
  "mac": "cmd+alt+t"
}
```

## Brain Fatigue Score

Your brain fatigue is estimated on a 0–45 point scale from your work time and break patterns.

| Score | Level | Guidance |
|-------|-------|----------|
| 🟢 0–10 | Good | Keep going as you are |
| 🟡 11–20 | Caution | Watch out for fatigue |
| 🟠 21–30 | Warning | Rest is recommended |
| 🔴 31–45 | Danger | Take a break right away |

<!-- Screenshot: statistics view and brain fatigue score -->
<!-- ![Statistics view](images/screenshots/stats.png) -->

For a detailed assessment, visit the [BrainSync brain fatigue assessment](https://donut-service.com/brain-fatigue-assessment/).

## Customization

You can customize the following under Settings > Extensions > BrainSync:

| Setting | Default | Range |
|---------|---------|-------|
| Work duration | 30 min | 15–60 min |
| Short break duration | 5 min | 3–10 min |
| Long break duration | 15 min | 10–30 min |
| Sessions before a long break | 4 | 2–8 |
| Notifications | ON | ON/OFF |
| Sound | ON (bell) | bell/chime/silent |
| Volume | 50% | 0–100% |
| Auto-start break | ON | ON/OFF |
| Auto-start work | OFF | ON/OFF |
| Brain fatigue alert | ON | ON/OFF |
| Brain fatigue alert threshold | 21 points | 15–30 points |
| Do Not Disturb during work | OFF | ON/OFF |
| Slack integration | OFF | ON/OFF |
| Set Slack status automatically | ON | ON/OFF |
| Slack status text | 集中中 | Any string |
| Slack status emoji | :tomato: | Emoji code |

> **Do Not Disturb during work**: when enabled, VS Code notifications (toasts from other extensions, etc.) are automatically suppressed only during work sessions and restored on break or finish. Works on every OS with no setup.
> While suppression is active, the bell icon on the right of the status bar shows a bell-slash. If suppression ever gets stuck, turn it off manually with `BrainSync: Disable Do Not Disturb`.

## Slack Integration (Optional)

Automatically puts Slack into "focus mode" only during work sessions: notifications are snoozed (Do Not Disturb) and, optionally, your status is set to "🍅 Focusing". Everything is turned off automatically on break or finish. Works on every OS.

### Setup

You need to obtain a Slack token and register it first.

1. [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch** (choose your workspace)
2. **OAuth & Permissions** → add these two **User Token Scopes** (on the **User** side, not Bot):
   - `dnd:write` (snooze notifications)
   - `users.profile:write` (set status)
3. **Install to Workspace** → copy the issued **User OAuth Token (`xoxp-...`)**
4. In VS Code / Cursor, run the command `BrainSync: Connect Slack` and paste the token
5. Turn on **Slack integration** in the settings

### Behavior

- Work starts → Slack notifications are snoozed (DND) and your status is set automatically
- Slack shows the end time (until HH:MM) by itself (the status text does not include the time)
- Break, pause, or finish → everything is turned off automatically
- To disable the integration, run `BrainSync: Disconnect Slack`

> **Status text**: the default status text is the Japanese "集中中" ("Focusing"). You can change it to any string with the `brainsync.slackStatusText` setting.

### Disconnecting and Reconnecting

Once registered, the token is kept in your OS secure storage and **persists across restarts** (you normally don't need to enter it again).

However, **running `BrainSync: Disconnect Slack` deletes the token**. To reconnect after disconnecting, **you must register the token again with `BrainSync: Connect Slack`**.

- You can reuse the same User OAuth Token (`xoxp-...`) — disconnecting only removes it from the extension; the Slack app itself stays installed.
- If you no longer have the token, get it again from [api.slack.com/apps](https://api.slack.com/apps) → your app → **OAuth & Permissions**.
- If the token becomes invalid or expires, the extension disables the integration automatically and notifies you; register it again the same way afterwards.

### Privacy

- **The token is stored securely in VS Code's SecretStorage (your OS secure storage)** and is never written to settings files or synced to other machines. The storage location depends on the OS (macOS: Keychain / Windows: Credential Manager / Linux: libsecret-based keyring).
- The only destination is the Slack API (`https://slack.com`), and the only data sent is the snooze duration, the status text, and the token. **Session statistics and what you work on are never sent.**
- With the Slack integration disabled, the extension keeps working fully offline as before.

## Installation

### From the Marketplace (Recommended)

1. Search for "**BrainSync**" in the VS Code / Cursor extension marketplace
2. Click Install

### From the Command Line

```bash
# VS Code
code --install-extension donut-service.brainsync-focus-timer

# Cursor
cursor --install-extension donut-service.brainsync-focus-timer
```

## Privacy Policy

**Data stored locally:**
- Timer session records (start time, end time, completed/interrupted)
- Statistics (daily and weekly aggregates)
- Settings
- Slack token (only when using the Slack integration; kept in SecretStorage = your OS secure storage)

Timer data, statistics, and settings are stored in VS Code's Global State and never leave your computer. The Slack token is never written to plain-text settings files or synced to other machines.

**Data sent externally:**
- When opening the assessment page, UTM parameters (referrer information) are appended to the link
- **Only when the Slack integration is enabled**, the snooze duration, status text, and token are sent to the Slack API (`https://slack.com`)
- No personally identifiable information is ever sent
- Session data and statistics are never sent (not to Slack either)

## Security

- Scripts running inside the webview are protected by a Content Security Policy (CSP)
- No external scripts are ever loaded
- All data is stored locally; nothing is sent to external servers

## Troubleshooting

### Notifications are not shown

- Make sure `brainsync.notificationEnabled` is turned on in the extension settings
- If VS Code / Cursor's Do Not Disturb mode is on, notifications may be blocked. Under Settings > Notifications > "Enable Do Not Disturb mode", make sure **BrainSync Focus Timer is not checked** in the extension list (a checked entry blocks its notifications)

### The timer gets reset

The timer keeps running when you close a window, but its state may be reset if the editor exits completely. It is restored automatically when VS Code restarts.

### Sound is not playing

- Check that `brainsync.soundEnabled` is turned on in the extension settings
- Check that `brainsync.soundVolume` is not 0
- Check that `brainsync.soundFile` is not set to `silent`

### Statistics disappeared

Data is stored in Global State and is removed when the extension is uninstalled. We recommend exporting regularly.

## Contributing

Please report bugs and request features via [GitHub Issues](https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension/issues).

Pull requests are welcome!

## License

MIT License — see [LICENSE](LICENSE) for details

## Author

**Donut Service**
- Website: https://donut-service.com
- Email: contact@donut-service.com

## Links

- [BrainSync official site](https://donut-service.com)
- [Brain fatigue assessment page](https://donut-service.com/brain-fatigue-assessment/)
- [GitHub repository](https://github.com/YukiTachi/brainsync-pomodoro-vscode-extension)
- [Changelog](CHANGELOG.md)
