#!/bin/bash

# Test script to check if wp-outdated-fetch endpoint is working

echo "Testing wp-outdated-fetch endpoint..."

# Test with a sample WordPress site
curl -X POST "http://localhost:8001/tasks/wp-outdated-fetch" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://wordpress.org",
       "timeout": 15,
       "headers": {},
       "report_email": null,
       "basic_auth": null
     }' | jq .

echo -e "\n\nTesting task status endpoint..."

# You can use the task_id from the above response to check status
# curl -X GET "http://localhost:8001/tasks/{task_id}/status" | jq .