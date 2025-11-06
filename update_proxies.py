
import json
import requests
import sys
from typing import List, Dict, Any

GEONODE_API_URL = "https://proxylist.geonode.com/api/proxy-list"
CONFIG_FILE = "config.json"

API_PARAMS = {
    "protocols": "socks5",
    "limit": 500,
    "page": 1,
    "sort_by": "lastChecked",
"anonymityLevel": "elite",
    "sort_type": "desc"
}


def fetch_proxies() -> List[Dict[str, Any]]:

    print(f"Fetching proxies from GeoNode API...")
    print(f"Parameters: {API_PARAMS}")

    try:
        response = requests.get(GEONODE_API_URL, params=API_PARAMS, timeout=30)
        response.raise_for_status()

        data = response.json()
        proxies = data.get("data", [])

        print(f"Successfully fetched {len(proxies)} proxies")
        return proxies

    except requests.exceptions.RequestException as e:
        print(f"Error fetching proxies: {e}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON response: {e}")
        sys.exit(1)


def format_proxy_url(proxy: Dict[str, Any]) -> str:

    ip = proxy.get("ip")
    port = proxy.get("port")
    protocols = proxy.get("protocols", [])

    if "socks5" in protocols:
        return f"socks5://{ip}:{port}"
    elif "socks4" in protocols:
        return f"socks4://{ip}:{port}"
    elif "http" in protocols:
        return f"http://{ip}:{port}"

    return None


def filter_proxies(proxies: List[Dict[str, Any]], min_speed: int = 90, min_uptime: float = 90.0) -> List[Dict[str, Any]]:

    filtered = []

    for proxy in proxies:
        speed = proxy.get("speed", 0)
        uptime = proxy.get("upTime", 0)

        if speed >= min_speed and uptime >= min_uptime:
            filtered.append(proxy)

    print(f"Filtered to {len(filtered)} high-quality proxies (speed >= {min_speed}, uptime >= {min_uptime}%)")
    return filtered


def update_config(proxy_urls: List[str]) -> None:

    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)

        print(f" Loaded existing config from {CONFIG_FILE}")

        old_proxy = config.get("proxyURL")
        config["proxyURL"] = proxy_urls

        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=4)

        print(f"Updated {CONFIG_FILE} with {len(proxy_urls)} proxies")
        print(f"  Old proxy config: {old_proxy}")
        print(f"  New proxy count: {len(proxy_urls)}")

    except FileNotFoundError:
        print(f" Config file not found: {CONFIG_FILE}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f" Error parsing config file: {e}")
        sys.exit(1)
    except IOError as e:
        print(f" Error reading/writing config file: {e}")
        sys.exit(1)


def print_proxy_stats(proxies: List[Dict[str, Any]]) -> None:
    
    if not proxies:
        return

    print("\n" + "="*60)
    print("PROXY STATISTICS")
    print("="*60)

    countries = {}
    for proxy in proxies:
        country = proxy.get("country", "Unknown")
        countries[country] = countries.get(country, 0) + 1

    print(f"\nCountry Distribution (Top 5):")
    for country, count in sorted(countries.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"  {country}: {count} proxies")

    speeds = [p.get("speed", 0) for p in proxies]
    avg_speed = sum(speeds) / len(speeds) if speeds else 0

    print(f"\nSpeed Statistics:")
    print(f"  Average: {avg_speed:.2f}")
    print(f"  Min: {min(speeds)}")
    print(f"  Max: {max(speeds)}")

    uptimes = [p.get("upTime", 0) for p in proxies]
    avg_uptime = sum(uptimes) / len(uptimes) if uptimes else 0

    print(f"\nUptime Statistics:")
    print(f"  Average: {avg_uptime:.2f}%")
    print(f"  Min: {min(uptimes):.2f}%")
    print(f"  Max: {max(uptimes):.2f}%")

    print("="*60 + "\n")


def main():
    """Main function"""
    print("\n" + "="*60)
    print("COMPOSITE API - PROXY UPDATER")
    print("="*60 + "\n")

    proxies = fetch_proxies()

    if not proxies:
        print(" No proxies fetched. Exiting.")
        sys.exit(1)

    filtered_proxies = filter_proxies(proxies, min_speed=90, min_uptime=90.0)

    if not filtered_proxies:
        print(" No proxies meet quality criteria. Using all fetched proxies instead.")
        filtered_proxies = proxies

    print_proxy_stats(filtered_proxies)

    proxy_urls = [url for url in [format_proxy_url(p) for p in filtered_proxies] if url is not None]

    if not proxy_urls:
        print(" No HTTP proxies found after formatting. Exiting.")
        sys.exit(1)

    print(f"\nSample proxy URLs (first 5):")
    for url in proxy_urls[:5]:
        print(f"  {url}")

    print()
    update_config(proxy_urls)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
