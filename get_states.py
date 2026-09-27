import urllib.request
import re

html = urllib.request.urlopen('https://download.geofabrik.de/north-america/us.html').read().decode('utf-8')
links = re.findall(r'<a href="us/([^.]+)\.html">([^<]+)</a>', html)

print("const US_STATES = [")
for link_id, name in links:
    print(f"    {{ id: '{link_id}', name: '{name}' }},")
print("];")
