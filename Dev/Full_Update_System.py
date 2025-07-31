import requests

# === CONFIG ===
BASE_URL = "http://localhost/TestWP1"
STATUS_URL = f"{BASE_URL}/wp-json/site/v1/status"
UPDATE_PLUGINS_URL = f"{BASE_URL}/wp-json/custom/v1/update-plugins"
UPDATE_CORE_URL = f"{BASE_URL}/wp-json/custom/v1/update-core"
AUTH = ("admin", "admin")  # Change this

# === Blocklisted Plugins (won't be shown for update) ===
BLOCKLIST = [
    # "hello.php",
    # "akismet/akismet.php",
]


def fetch_status():
    res = requests.get(STATUS_URL)
    res.raise_for_status()
    return res.json()


def display_status(data):
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


def choose_plugins(plugins):
    choices = []
    for i, p in enumerate(plugins, start=1):
        if not p.get("update_available"):
            continue

        plugin_file = p.get("plugin_file")  # use this for identification
        if not plugin_file:
            print(f"⚠️ Missing plugin_file in: {p}")
            continue

        if plugin_file in BLOCKLIST:
            print(f"⛔ Blocked: {plugin_file}")
            continue

        choices.append((i, plugin_file, p["name"]))

    if not choices:
        print("✅ No plugins to update or all are blocklisted.")
        return []

    print("\n🛠️ Choose Plugins to Update:")
    for i, slug, name in choices:
        print(f" {i}. {name}")

    selected = input("Enter plugin numbers (comma-separated) or 'all': ").strip().lower()
    if selected == "all":
        return [slug for _, slug, _ in choices]

    selected_indexes = {int(x.strip()) for x in selected.split(",") if x.strip().isdigit()}
    return [slug for i, slug, _ in choices if i in selected_indexes]


def update_plugins(slugs):
    if not slugs:
        print("🚫 No plugins selected for update.")
        return

    payload = {"plugins": ",".join(slugs)}
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    res = requests.post(UPDATE_PLUGINS_URL, auth=AUTH, data=payload, headers=headers)

    print("\n🚀 Plugin Update Triggered!")
    print("Status:", res.status_code)
    try:
        print("Response:", res.json())
    except Exception:
        print("Raw Response:", res.text)


def update_wp_core():
    res = requests.post(UPDATE_CORE_URL, auth=AUTH)
    print("\n⚙️ WordPress Core Update Triggered")
    print("Status:", res.status_code)
    try:
        print(res.json())
    except:
        print("Raw:", res.text)


# === Main Menu ===
if __name__ == "__main__":
    try:
        data = fetch_status()
        print("📡 Connected to WordPress Site")
        display_status(data)

        print("\n💬 What would you like to update?")
        print(" 1. WordPress Core")
        print(" 2. Plugins")
        choice = input("Enter option (1 or 2): ").strip()

        if choice == "1":
            update_wp_core()
        elif choice == "2":
            plugin_slugs = choose_plugins(data["plugins"])
            update_plugins(plugin_slugs)
        else:
            print("❌ Invalid option.")

    except Exception as e:
        print("❌ Error:", e)
