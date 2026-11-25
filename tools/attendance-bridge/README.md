# Fingerprint machine bridge (ZKTeco K50)

Copies punches from the office fingerprint machine into AmzCentric OS. It runs on any Windows PC in the office that is on during office hours. Every 5 minutes it reads the machine over the office network and sends only the new punches. If the PC was off, nothing is lost: the machine keeps its punches, and the next run catches up.

The app can't reach the machine directly because the machine is on the office network and the app runs on the internet. So this small script on an office PC passes the punches along.

## What you need

- The machine and the PC on the same office network (same router / Wi-Fi).
- The machine's IP address: on the K50, **Menu → Comm. → Ethernet → IP Address** (e.g. `192.168.1.201`). Give it a fixed IP so it doesn't change. On the machine, set DHCP off and keep that address.
- `ATTENDANCE_TOKEN`, set in Vercel (see below).

## Setup (once, about 15 minutes)

1. **Token.** In PowerShell, generate a random value:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) | Set-Clipboard
   ```
   In Vercel → Settings → Environment Variables, add `ATTENDANCE_TOKEN` with that value (Production), then **Redeploy**. Use a different value from `HR_API_TOKEN`.
2. **Python.** Install Python 3 from python.org (tick "Add python.exe to PATH"), then in PowerShell:
   ```powershell
   pip install pyzk
   ```
3. **Files.** Copy this folder (`zk_bridge.py`, `bridge.example.ini`, `run_bridge.bat`) to the PC, e.g. `C:\AmzCentric\attendance-bridge`.
4. **Config.** Copy `bridge.example.ini` to `bridge.ini` and fill in the machine's IP and the token. Don't share `bridge.ini`: it holds the token.
5. **Test.** In that folder:
   ```powershell
   python zk_bridge.py --dry-run
   ```
   It should print the number of users and punches on the machine. Then send the last 2 months:
   ```powershell
   python zk_bridge.py --days 60
   ```
6. **Match people.** In AmzCentric OS → **Settings → HR → People**, enter each person's **Machine ID**: the user number they were enrolled with on the machine. The Machine ID box suggests the numbers and names the bridge found, and the Fingerprint machine card lists any that aren't matched yet.
7. **Schedule.** Task Scheduler → **Create Basic Task** → name "AmzCentric attendance" → Daily → Action "Start a program" → `run_bridge.bat` in that folder. Then open the task's **Properties**:
   - **Triggers → Edit → Repeat task every 5 minutes for a duration of 1 day.**
   - **General → Run whether user is logged on or not.**

   Output goes to `bridge.log` in the same folder.

## Check it's working

Settings → HR → Fingerprint machine shows **Last punch received**. On the HR page, people who punched in show as **Office** with their first-in time.

## If it stops

- `bridge.log` says it can't connect: the PC and the machine aren't on the same network, or the machine's IP changed. Ping the IP from the PC.
- `HTTP 401`: the token in `bridge.ini` doesn't match `ATTENDANCE_TOKEN` in Vercel, or Vercel wasn't redeployed after setting it.
- `HTTP 503`: `ATTENDANCE_TOKEN` isn't set in Vercel.
- No PC available: export the attendance log to a USB stick on the machine and upload `attlog.dat` in **Settings → HR → Fingerprint machine**.

Time on the machine is the office's local time. Keep the machine's clock right: **Menu → System → Date/Time**.
