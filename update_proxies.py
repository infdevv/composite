
import json
import sys
import ipaddress
import argparse
import concurrent.futures
from typing import List, Dict, Any, Optional
from datetime import datetime
from proxyscrape import create_collector
import requests  # Still needed for proxy testing

CONFIG_FILE = "config.json"

# Proxy configuration for proxyscrape library
PROXY_CONFIG = {
    "type": "socks5",  # socks5, socks4, http, https
    "anonymity": "elite",  # elite, anonymous, transparent
    "country": "all"
}

# Cloudflare IP ranges (IPv4)
CLOUDFLARE_IP_RANGES = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22"
]


def fetch_proxies_from_proxyscrape(proxy_type: str = "socks5") -> List[Dict[str, Any]]:
    """Fetch proxies from ProxyScrape using the proxyscrape library"""
    print(f"\nFetching {proxy_type} proxies from ProxyScrape...\n")

    try:
        # Create a collector for the specified proxy type
        collector = create_collector('my-collector', proxy_type)

        # Get the proxies
        proxy_list = collector.get_proxies()

        proxies = []
        for proxy in proxy_list:
            # proxy object has host and port attributes
            proxies.append({
                "ip": proxy.host,
                "port": proxy.port,
                "protocols": [proxy_type],
                "country": "Unknown",
                "speed": 50,  # Default values
                "upTime": 50,
                "source": "proxyscrape"
            })

        print(f"  [OK] Fetched {len(proxies)} proxies from ProxyScrape")

        # Remove duplicates based on IP:PORT
        seen = set()
        unique_proxies = []
        for proxy in proxies:
            key = f"{proxy['ip']}:{proxy['port']}"
            if key not in seen:
                seen.add(key)
                unique_proxies.append(proxy)

        duplicates_removed = len(proxies) - len(unique_proxies)
        if duplicates_removed > 0:
            print(f"  Removed {duplicates_removed} duplicates")
        print(f"  Total unique proxies: {len(unique_proxies)}")

        return unique_proxies
    except Exception as e:
        print(f"  [FAIL] ProxyScrape failed: {e}")
        return []


def is_cloudflare_ip(ip: str) -> bool:
    """Check if an IP address belongs to Cloudflare's network"""
    try:
        ip_obj = ipaddress.ip_address(ip)
        for cidr in CLOUDFLARE_IP_RANGES:
            if ip_obj in ipaddress.ip_network(cidr):
                return True
        return False
    except ValueError:
        # Invalid IP address
        return False


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


def test_proxy(proxy_url: str, timeout: int = 10) -> bool:
    """Test if a proxy is working by making a request through it"""
    try:
        test_url = "https://httpbin.org/ip"
        proxies = {
            "http": proxy_url,
            "https": proxy_url
        }
        response = requests.get(test_url, proxies=proxies, timeout=timeout)
        if response.status_code == 200:
            data = response.json()
            # Verify we got a different IP than our own
            return "origin" in data
        return False
    except:
        return False


def validate_proxies(proxy_urls: List[str], max_workers: int = 20, test: bool = False) -> List[str]:
    """Validate proxies by testing them in parallel"""
    if not test:
        return proxy_urls

    print(f"\nValidating {len(proxy_urls)} proxies (testing connectivity)...")
    print("This may take a few minutes...\n")

    working_proxies = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_proxy = {executor.submit(test_proxy, url): url for url in proxy_urls}
        completed = 0

        for future in concurrent.futures.as_completed(future_to_proxy):
            proxy_url = future_to_proxy[future]
            completed += 1

            try:
                if future.result():
                    working_proxies.append(proxy_url)
                    print(f"[{completed}/{len(proxy_urls)}] [OK] {proxy_url}")
                else:
                    print(f"[{completed}/{len(proxy_urls)}] [FAIL] {proxy_url}")
            except Exception as e:
                print(f"[{completed}/{len(proxy_urls)}] [FAIL] {proxy_url} - Error: {e}")

    print(f"\n[OK] {len(working_proxies)}/{len(proxy_urls)} proxies are working")
    return working_proxies


def filter_proxies(proxies: List[Dict[str, Any]],
                   min_speed: int = 0,
                   min_uptime: float = 0.0,
                   countries: Optional[List[str]] = None,
                   protocols: Optional[List[str]] = None,
                   exclude_cloudflare: bool = True) -> List[Dict[str, Any]]:
    """Filter proxies based on various criteria"""

    filtered = []
    cloudflare_count = 0

    for proxy in proxies:
        speed = proxy.get("speed", 0)
        uptime = proxy.get("upTime", 0)
        ip = proxy.get("ip", "")
        country = proxy.get("country", "Unknown")
        proxy_protocols = proxy.get("protocols", [])

        # Skip Cloudflare IPs if requested
        if exclude_cloudflare and is_cloudflare_ip(ip):
            cloudflare_count += 1
            continue

        # Filter by speed and uptime
        if speed < min_speed or uptime < min_uptime:
            continue

        # Filter by country if specified
        if countries and country not in countries:
            continue

        # Filter by protocol if specified
        if protocols:
            has_protocol = any(p in proxy_protocols for p in protocols)
            if not has_protocol:
                continue

        filtered.append(proxy)

    if exclude_cloudflare:
        print(f"Excluded {cloudflare_count} Cloudflare IPs")
    print(f"Filtered to {len(filtered)} proxies (speed >= {min_speed}, uptime >= {min_uptime}%)")

    if countries:
        print(f"  Country filter: {', '.join(countries)}")
    if protocols:
        print(f"  Protocol filter: {', '.join(protocols)}")

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


def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Fetch and update SOCKS5 proxies from multiple sources",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage - fetch all proxies
  python update_proxies.py

  # Fetch only high-quality proxies
  python update_proxies.py --min-speed 90 --min-uptime 90

  # Filter by specific countries
  python update_proxies.py --countries US,GB,CA

  # Test proxies before saving (slower but more reliable)
  python update_proxies.py --test --limit 50

  # Search for proxies without updating config
  python update_proxies.py --search --countries US --min-speed 80

  # Limit number of proxies
  python update_proxies.py --limit 100
        """
    )

    parser.add_argument("--min-speed", type=int, default=0,
                        help="Minimum proxy speed (0-100, default: 0)")
    parser.add_argument("--min-uptime", type=float, default=0.0,
                        help="Minimum proxy uptime percentage (default: 0)")
    parser.add_argument("--countries", type=str,
                        help="Comma-separated list of country codes (e.g., US,GB,CA)")
    parser.add_argument("--protocols", type=str, default="socks5",
                        help="Comma-separated list of protocols (default: socks5)")
    parser.add_argument("--test", action="store_true",
                        help="Test each proxy before saving (slower but more reliable)")
    parser.add_argument("--limit", type=int,
                        help="Limit number of proxies to fetch")
    parser.add_argument("--search", action="store_true",
                        help="Search mode - display results without updating config")
    parser.add_argument("--no-cloudflare", action="store_true", default=True,
                        help="Exclude Cloudflare IPs (default: true)")

    return parser.parse_args()


def main():
    """Main function"""
    args = parse_arguments()

    print("\n" + "="*60)
    print("COMPOSITE API - PROXY UPDATER")
    print("="*60 + "\n")

    # Parse protocol from arguments
    protocols = args.protocols.split(',') if args.protocols else ["socks5"]
    proxy_type = protocols[0]  # Use the first protocol specified

    # Fetch proxies from ProxyScrape
    proxies = fetch_proxies_from_proxyscrape(proxy_type=proxy_type)

    if not proxies:
        print("[FAIL] No proxies fetched. Exiting.")
        sys.exit(1)

    # Parse filter arguments
    countries = args.countries.split(',') if args.countries else None
    protocols = args.protocols.split(',') if args.protocols else None

    # Filter proxies
    print("\nApplying filters...")
    filtered_proxies = filter_proxies(
        proxies,
        min_speed=args.min_speed,
        min_uptime=args.min_uptime,
        countries=countries,
        protocols=protocols,
        exclude_cloudflare=args.no_cloudflare
    )

    if not filtered_proxies:
        print("\n[FAIL] No proxies meet quality criteria.")
        response = input("Use all fetched proxies instead? (y/n): ")
        if response.lower() == 'y':
            filtered_proxies = proxies
        else:
            sys.exit(1)

    # Limit number of proxies if specified
    if args.limit and len(filtered_proxies) > args.limit:
        print(f"\nLimiting to {args.limit} proxies...")
        filtered_proxies = filtered_proxies[:args.limit]

    # Print stats
    print_proxy_stats(filtered_proxies)

    # Format proxy URLs
    proxy_urls = [url for url in [format_proxy_url(p) for p in filtered_proxies] if url is not None]

    if not proxy_urls:
        print("[FAIL] No valid proxies found after formatting. Exiting.")
        sys.exit(1)

    # Test proxies if requested
    if args.test:
        proxy_urls = validate_proxies(proxy_urls, test=True)
        if not proxy_urls:
            print("\n[FAIL] No working proxies found after testing.")
            sys.exit(1)

    # Display sample proxies
    print(f"\nSample proxy URLs (first 10):")
    for url in proxy_urls[:10]:
        print(f"  {url}")

    if len(proxy_urls) > 10:
        print(f"  ... and {len(proxy_urls) - 10} more")

    # Search mode - just display, don't save
    if args.search:
        print("\n" + "="*60)
        print("SEARCH MODE - Results displayed above")
        print("Run without --search flag to update config.json")
        print("="*60)
        return

    # Update config
    print()
    update_config(proxy_urls)

    print("\n" + "="*60)
    print("[OK] DONE! Config updated successfully")
    print("="*60)


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
