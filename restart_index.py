import subprocess
import time

while True:
    process = subprocess.Popen(['node', 'index.js'])
    time.sleep(1 * 60 * 10)  # 30 minutes
    process.terminate()
    process.wait()