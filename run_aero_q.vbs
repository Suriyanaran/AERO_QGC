Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\SURYA P\QGC\Aero-Q-GCS"
cmd = Chr(34) & "C:\Users\SURYA P\AppData\Local\Programs\Python\Python312\python.exe" & Chr(34) & " " & Chr(34) & "C:\Users\SURYA P\QGC\Aero-Q-GCS\app_launcher.py" & Chr(34)
WshShell.Run cmd, 0, False
