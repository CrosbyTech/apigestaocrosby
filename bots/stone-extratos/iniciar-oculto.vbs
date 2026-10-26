' Inicia o agente sem janela (usado pelo atalho da pasta Startup)
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = pasta
shell.Run "cmd /c node """ & pasta & "\bot.mjs"" >> """ & pasta & "\agente.log"" 2>&1", 0, False
