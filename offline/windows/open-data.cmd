@echo off
set "YDL_DATA=%LOCALAPPDATA%\YDL S4 Offline"
if not exist "%YDL_DATA%" mkdir "%YDL_DATA%"
explorer.exe "%YDL_DATA%"
