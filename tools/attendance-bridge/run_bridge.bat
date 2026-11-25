@echo off
rem Runs the bridge from this folder; Task Scheduler calls this every 5 minutes.
cd /d "%~dp0"
python zk_bridge.py >> bridge.log 2>&1
