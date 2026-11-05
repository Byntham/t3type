"""Checks every passage in a research JSON file against its source.

Articles: fetches the page and checks each "..."-separated segment appears.
X posts: fetches the post text from api.fxtwitter.com and checks author and text.
Usage: python3 -I scripts/verify_sources.py content/research/grok-passages.json
Exits 1 if any passage fails.
"""
import json, re, sys, html, urllib.request, concurrent.futures as cf
d = json.load(open(sys.argv[1]))
def norm(s):
    s = html.unescape(s)
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s = re.sub(r'[–—]', ' - ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s.lower())
    return ' '.join(s.split())
cache = {}
def fetch(u):
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 swetype-verify'})
        raw = urllib.request.urlopen(req, timeout=20).read().decode('utf8','ignore')
        raw = re.sub(r'<script.*?</script>|<style.*?</style>|<sup.*?</sup>', ' ', raw, flags=re.S)
        return norm(re.sub(r'<[^>]+>', ' ', raw))
    except Exception as e:
        return None
urls = sorted({p['sourceUrl'] for p in d['passages'] if 'x.com' not in p['sourceUrl'] and 'twitter.com' not in p['sourceUrl']})
with cf.ThreadPoolExecutor(12) as ex:
    for u, t in zip(urls, ex.map(fetch, urls)): cache[u] = t
res = {}
for p in d['passages']:
    u = p['sourceUrl']
    if u not in cache: res[p['id']] = 'x-post'; continue
    page = cache[u]
    if page is None: res[p['id']] = 'fetch-failed'; continue
    segs = [norm(s) for s in re.split(r'\.\.\.', p['text']) if norm(s)]
    found = [s in page for s in segs]
    if all(found): res[p['id']] = 'ok'
    else:
        # partial: check 6-word shingles
        words = norm(p['text']).split()
        sh = [' '.join(words[i:i+6]) for i in range(0, max(1,len(words)-5))]
        frac = sum(s in page for s in sh)/len(sh)
        res[p['id']] = f'MISMATCH {frac:.0%}'

def norm_x(s):
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s = re.sub(r'https?://\S+|@\w+', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s.lower()); return ' '.join(s.split())
def fetch(u):
    m = re.search(r'status/(\d+)', u)
    if not m: return None
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.fxtwitter.com/status/{m.group(1)}', headers={'User-Agent':'swetype-verify'}), timeout=20))
        t = r['tweet']; txt = t.get('text','')
        if t.get('article'): txt += ' ' + json.dumps(t['article'])
        return t['author']['screen_name'].lower(), norm_x(txt)
    except Exception as e: return None
xs = [p for p in d['passages'] if res[p['id']] == 'x-post']
with cf.ThreadPoolExecutor(8) as ex: got = list(ex.map(lambda p: fetch(p['sourceUrl']), xs))
for p, g in zip(xs, got):
    if g is None: res[p['id']] = 'x-fetch-failed'; continue
    who, txt = g
    if who != p['handle'].lstrip('@').lower(): res[p['id']] = f'X-WRONG-AUTHOR {who}'; continue
    segs = [norm_x(s) for s in p['text'].split('...') if norm_x(s)]
    res[p['id']] = 'ok' if all(s in txt for s in segs) else 'X-MISMATCH'
from collections import Counter; print(Counter(res.values()))
for k,v in res.items():
    if v != 'ok': print(k, v)

sys.exit(0 if all(v == 'ok' for v in res.values()) else 1)
