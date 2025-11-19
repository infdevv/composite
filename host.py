# Weird fix, ik

import subprocess
import asyncio
import json
import requests
import signal
import sys
import os

current_process = None

def cleanup(signum=None, frame=None):
    """Cleanup handler to kill node process on exit"""
    global current_process
    if current_process:
        print("\nCleaning up and killing node process...")
        try:
            if sys.platform == "win32":
                # On Windows, kill the entire process tree
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(current_process.pid)],
                             stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            else:
                # On Unix-like systems, kill the process group
                os.killpg(os.getpgid(current_process.pid), signal.SIGTERM)
                current_process.wait(timeout=5)
        except Exception as e:
            print(f"Error during cleanup: {e}")
    sys.exit(0)

# Register cleanup handlers
signal.signal(signal.SIGINT, cleanup)  # Handle Ctrl+C
signal.signal(signal.SIGTERM, cleanup)  # Handle termination
if sys.platform == "win32":
    signal.signal(signal.SIGBREAK, cleanup)  # Handle Ctrl+Break on Windows

with open("config.json") as config:
    cfg = json.load(config)
    list2 = requests.get("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/refs/heads/master/socks4.txt").text.split("\n")
    for i in range(len(list2)):
        list2[i] = "socks4://" + list2[i]
    cfg["proxyURL"] = list2# requests.get("https://raw.githubusercontent.com/monosans/proxy-list/refs/heads/main/proxies/all.txt").text.split("\n") #+ list2 
    with open("config.json", "w+") as config:
        json.dump(cfg, config, indent=4)
        print("Added " + str(len(cfg["proxyURL"])) + " proxies")

async def kill_process(process):
    """Kill the process and all its children"""
    if process:
        try:
            if sys.platform == "win32":
                # On Windows, kill the entire process tree
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                             stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            else:
                # On Unix-like systems, kill the process group
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)

            # Wait for process to actually terminate
            try:
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                print("Process didn't terminate gracefully, forcing...")
                if sys.platform != "win32":
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except Exception as e:
            print(f"Error killing process: {e}")

async def restart_process():
    global current_process
    while True:
        if sys.platform == "win32":
            # On Windows, use CREATE_NEW_PROCESS_GROUP to make process tree management easier
            current_process = await asyncio.create_subprocess_shell(
                "npm start",
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            # On Unix-like systems, create a new process group
            current_process = await asyncio.create_subprocess_shell(
                "npm start",
                preexec_fn=os.setsid
            )

        await asyncio.sleep(1 * 60 * 10)
        print("Restarting process...")

        # Kill the process and wait for it to terminate
        await kill_process(current_process)

        # Update proxies
        with open("config.json") as config:
            cfg = json.load(config)
            cfg["proxyURL"] = requests.get("https://raw.githubusercontent.com/monosans/proxy-list/refs/heads/main/proxies/all.txt").text.split("\n")
            with open("config.json", "w+") as config:
                json.dump(cfg, config, indent=4)
                print("Added " + str(len(cfg["proxyURL"])) + " proxies")

        await asyncio.sleep(.2)

try:
    asyncio.run(restart_process())
except KeyboardInterrupt:
    cleanup()
except Exception as e:
    print(f"Error: {e}")
    cleanup()
    