import requests
from requests.auth import HTTPBasicAuth

url = "http://localhost/TestWP2/wp-json/custom/v1/update-core"
auth = HTTPBasicAuth('admin', 'admin')

response = requests.post(url, auth=auth)
print(response.status_code, response.text)
