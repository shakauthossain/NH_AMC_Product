import re
import json
import requests

def extract_json_from_html(html):
    match = re.search(r"\{.*\}", html, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    else:
        raise ValueError("No JSON found in HTML")

def trigger_wordpress_updates():
    url = "http://localhost/TestWP/wp-json/site/v1/update"
    secret = "your_secret_token_here"

    try:
        res = requests.post(url, data={'secret': secret})
        print("Status:", res.status_code)

        print("✅ Raw Text Response:")
        print(res.text[:500])  # show first 500 characters

        try:
            print("\n✅ Parsed JSON (if clean):")
            print(res.json())
        except Exception as e:
            print("❌ JSON Parse Error:", e)

        return res  # return the response for later use

    except Exception as e:
        print("❌ Error:", e)
        return None

# Run the update trigger
res = trigger_wordpress_updates()

# Extract and print JSON safely
if res:
    try:
        data = extract_json_from_html(res.text)
        print("\n✅ Extracted JSON from HTML:")
        print(data)
    except Exception as e:
        print("❌ Could not extract JSON:", e)
