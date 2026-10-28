"""Point a fresh Webflow export at the copies kept in this repo instead of Webflow hosting.
Run from the repo root: python3 scripts/localize.py"""
import glob

W = 'https://cdn.prod.website-files.com/69b741bfa24ee9adba91b98a/'
REPLACE = {
    'https://cdn.prod.website-files.com/gsap/3.15.0/': 'js/vendor/',
    'https://d3e54v103j8qbb.cloudfront.net/js/jquery-3.5.1.min.dc5e7f18c8.js?site=69b741bfa24ee9adba91b98a': 'js/vendor/jquery-3.5.1.min.js',
    W + '6ad1bfa1c02ca94a052c4ada_Adessa-OG.jpg': 'https://adessamind.com/images/Adessa-OG.jpg',
    W + '69b96eadd99e8a31dd231311_og-1.png': 'https://adessamind.com/images/og-1.png',
    W + '69cd6f6b54e6c3097051c607_Adessa-Miami-og.jpg': 'https://adessamind.com/images/Adessa-Miami-og.jpg',
    W + '69b8778e1a23cb875461648c_noise.svg': 'images/noise.svg',
    W + '69cda94d1d4877540e442dd4_adessa-ripple.json.txt': 'documents/adessa-ripple.json.txt',
    'https://d3e54v103j8qbb.cloudfront.net/plugins/Basic/assets/placeholder.60f9b1840c.svg': 'images/placeholder.svg',
    'https://s3.amazonaws.com/webflow-prod-assets/69b741bfa24ee9adba91b98a/6a4bbc289eca813857d0dfb7_Adessa-home.webm': 'videos/Adessa-home.webm',
}

for path in glob.glob('*.html'):
    text = open(path, encoding='utf-8').read()
    new = text
    for old, local in REPLACE.items():
        new = new.replace(old, local)
    if new != text:
        open(path, 'w', encoding='utf-8').write(new)
        print('updated', path)

left = set()
for path in glob.glob('*.html'):
    for host in ('website-files.com', 'cloudfront.net', 'webflow-prod-assets'):
        if host in open(path, encoding='utf-8').read():
            left.add((path, host))
for path, host in sorted(left):
    print(f'still points at {host}: {path} (new asset? add it to REPLACE)')
