@echo off
rem Forward every argument to generate-cli-schema.mjs.
rem   generate-cli-schema.bat ffmpeg
rem   generate-cli-schema.bat ffmpeg --no-web
rem   generate-cli-schema.bat ffmpeg --stamp-groups
node "%~dp0generate-cli-schema.mjs" %*
exit /b %ERRORLEVEL%
