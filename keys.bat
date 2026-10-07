@echo off
rem Opens the private settings file (.env.local) in Notepad, creating it on first use.
cd /d "%~dp0"
if not exist .env.local copy .env.example .env.local >nul
start "" notepad .env.local
