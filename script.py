import urllib.request, json
req = urllib.request.urlopen("https://questlog.gg/aion-2/api/trpc/database.getRecipes?input=%7B%22language%22%3A%22zh%22%2C%22page%22%3A1%2C%22mainCategory%22%3A%22%22%2C%22subCategory%22%3A%22%22%2C%22facets%22%3A%7B%7D%7D")
data = json.loads(req.read().decode('utf-8'))
for item in data['result']['data']['json']['pageData']:
    print(f"{item['grade']} : {item['name']}")
