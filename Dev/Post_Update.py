import requests

STATUS_URL = "http://localhost/TestWP1/wp-json/site/v1/status"
UPDATE_URL = "http://localhost/TestWP1/wp-json/custom/v1/update-plugins"
AUTH = ("admin", "admin")  # Change to your real credentials

# --- Plugins you NEVER want to update
BLOCKLIST = {
}


def fetch_status():
    res = requests.get(STATUS_URL)
    if res.status_code != 200:
        raise Exception(f"Failed to fetch status. HTTP {res.status_code}")
    return res.json()


# Instead of trying to guess, use plugin['slug'] directly
def choose_plugins(plugins):
    print("\n🔧 Outdated Plugins (excluding blocklist):")
    choices = []
    for i, p in enumerate(plugins, start=1):
        if not p["update_available"]:
            continue
        slug = p["slug"]  # ✅ Use real slug from the status response
        if slug in BLOCKLIST:
            print(f" ❌ SKIP [BLOCKED]: {p['name']} ({p['version']} → {p['latest_version']})")
            continue

        print(f" {i}. {p['name']} ({p['version']} → {p['latest_version']})")
        choices.append((i, slug, p["name"]))

    if not choices:
        print("✅ No plugins to update or all are blocklisted.")
        return []

    selected = input("\nEnter plugin numbers to update (comma-separated), or 'all': ").strip()
    if selected.lower() == "all":
        return [slug for _, slug, _ in choices]

    selected_indexes = {int(x.strip()) for x in selected.split(",") if x.strip().isdigit()}
    slugs = [slug for i, slug, _ in choices if i in selected_indexes]
    return slugs


def get_plugin_slug(plugin_dict):
    # Convert from name to slug by reverse matching status data
    # NOTE: Adjust logic if you want to fetch real slugs from status
    # For now we'll pretend names are unique
    name = plugin_dict["name"]
    for slug in ALL_PLUGIN_SLUGS:
        if name.lower() in slug.lower():
            return slug
    return None


def perform_update(plugin_slugs):
    if not plugin_slugs:
        print("🚫 No plugins selected for update.")
        return

    payload = {"plugins": ",".join(plugin_slugs)}
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    res = requests.post(UPDATE_URL, auth=AUTH, data=payload, headers=headers)
    print(res.text)  # raw output
    print("👉 UPDATE_URL:", UPDATE_URL)
    print("👉 Payload:", payload)
    print("👉 Headers:", headers)
    print("\n🚀 Update Triggered!")
    print(f"Status Code: {res.status_code}")
    print("Response:")
    print(res.json())


if __name__ == "__main__":
    try:
        status = fetch_status()

        # Extract installed plugin slugs from the status
        ALL_PLUGIN_SLUGS = [
            f"{slug}/{slug}.php" if '/' not in slug else slug
            for slug in [p["name"].lower().replace(" ", "-") for p in status["plugins"]]
        ]

        print("📡 Connected to WordPress Site\n")

        plugin_slugs_to_update = choose_plugins(status["plugins"])
        perform_update(plugin_slugs_to_update)

    except Exception as e:
        print("❌ Error:", e)