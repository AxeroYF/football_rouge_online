@echo off
"%~dp0runtime\node.exe" "%~dp0self-test.mjs"
set "exitCode=%ERRORLEVEL%"
echo.
if "%exitCode%"=="0" echo Offline package self-test passed.
if not "%exitCode%"=="0" echo Offline package self-test failed.
pause
exit /b %exitCode%
