import requests
import json

data ={
"url":"http://notionhive.com",
"renderType":"jpg"
}

url = 'http://PhantomJScloud.com/api/browser/v2/ak-ckgvm-rt07j-8fpjm-k5y33-w3cyc/';
req = requests.post(url, data=json.dumps(data))
results = req.content

print(results)