import discord 
import requests
import asyncio
from discord.ext import commands
import json 

with open('config.json', 'r') as f:
    config = json.load(f)

bot = commands.Bot(command_prefix='!', intents=discord.Intents.all())

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name} (ID: {bot.user.id})')
    print('------')
    bot.loop.create_task(interval(300)) # check every 5 minutes
    
@bot.command()
async def check(ctx):
    await ctx.send('Checking servers...')
    composite_status = requests.get("https://composite.seabase.xyz/health").status_code == 200
    kiwiai_status = requests.get("https://kiwialpha.seabase.xyz/health").status_code == 404
    await ctx.send

    await ctx.send(f'**Composite:** {composite_status}')
    await ctx.send(f'**Kiwi AI:** {kiwiai_status}')
# interval for every 5 minutes
async def check_servers():
    composite_status = requests.get("https://composite.seabase.xyz/health").status_code == 200
    kiwiai_status = requests.get("https://kiwialpha.seabase.xyz/health").status_code == 404

    channel = bot.get_channel(int(config['channel']))
    if channel is None:
        print(f"Error: Could not find channel with ID {config['channel']}")
        return

    if not composite_status:
        await channel.send(f'**Composite is down!** <@{config["owner"]}>')
    if not kiwiai_status:
        await channel.send(f'**Kiwi AI is down!** <@{config["owner"]}>')

async def interval(interval_seconds):
    while True:
        await asyncio.sleep(interval_seconds)
        await check_servers()

bot.run(config['token'])