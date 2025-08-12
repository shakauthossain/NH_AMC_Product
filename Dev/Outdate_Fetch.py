import requests

URL = "http://139.59.102.1/wp-json/site/v1/status"

def get_outdated_wp():
    try:
        res = requests.get(URL)
        print("Status:", res.status_code)
        # print("Raw content:\n", res.text[:500])
        data = res.json()

        print("\n🔧 Plugins:")
        for p in data['plugins']:
            status = "✅ Up-to-date" if not p['update_available'] else f"⬆️ {p['version']} → {p['latest_version']}"
            active = " (active)" if p['active'] else ""
            print(f" - {p['name']}{active}: {status}")

        print("\n🎨 Themes:")
        for t in data['themes']:
            status = "✅ Up-to-date" if not t['update_available'] else f"⬆️ {t['version']} → {t['latest_version']}"
            active = " (active)" if t['active'] else ""
            print(f" - {t['name']}{active}: {status}")

        print("\n⚙️ WordPress Core:")
        core = data['core']
        if core['update_available']:
            print(f" - {core['current_version']} → {core['latest_version']} (update available)")
        else:
            print(f" - {core['current_version']} (✅ up to date)")

        print("\n🧪 Server Environment:")
        print(f" - PHP Version: {data['php_mysql']['php_version']}")
        print(f" - MySQL Version: {data['php_mysql']['mysql_version']}")

    except Exception as e:
        print("Error:", e)

get_outdated_wp()
