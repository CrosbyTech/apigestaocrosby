' Inicia o agente sem janela (usado pela tarefa agendada)
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = pasta
shell.Run "node """ & pasta & "\agent.mjs""", 0, False
