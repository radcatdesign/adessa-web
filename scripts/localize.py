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


# --- Homepage video section: keep the line together over the video (added 2026-10-28) ---
HOME_VIDEO_MARK = 'adessa-web patch: single-line video caption'
HOME_VIDEO_EDITS = [
    # one line instead of two halves around a spacer
    ("""              <div data-text-anim="" class="text-left split-text">Your destination for </div>
              <div class="video-spacer"></div>
              <div data-text-anim-delay="0.6" data-text-anim="" class="text-right split-text">cognitive wellbeing.</div>""",
     """              <p data-text-anim="" class="split-text">Your destination for cognitive wellbeing.</p>"""),
    # the mobile !important width would override the scroll animation
    ("""      z-index: 5;
      @media (max-width: 768px) {
        width: 100vw !important;
      }""", """      z-index: 5;"""),
    # styles for the single line, light text and a soft shade over the video
    ("""      object-fit: cover;
    }
  </style>""", """      object-fit: cover;
    }
    /* adessa-web patch: single-line video caption */
    .p-la__video .text-wrapper { white-space: normal; flex-direction: row; padding: 0 24px; text-align: center; color: #1a1a1a; }
    .p-la__video .split-text { margin: 0; color: inherit; line-height: 1.2; text-wrap: balance; }
    .video-container::after { content: ""; position: absolute; inset: 0; background: rgb(34 29 23 / var(--shade, 0)); pointer-events: none; }
    .video-container video { height: 100lvh; min-height: 100vh; }
    @media (max-width: 768px) {
      .p-la__video .text-wrapper { flex-direction: row; }
      .p-la__video .split-text { font-size: 30px; }
    }
  </style>"""),
    # grow to the section's own size and fade the text to cream instead of pushing the halves apart
    ("""        width: '100vw',
        height: '100svh',
        borderRadius: '0px',""", """        width: '100%',
        height: '100%',
        borderRadius: '0px',"""),
    ("""      .to(
        '.video-spacer',
        {
          width: '110vw',
          height: '110svh',
          // margin: '0px 60px',
          duration: 1,
          ease: 'power2.inOut',
        },
        0.5,
      )""", """      .to('.p-la__video .text-wrapper', { color: '#fffaf0', textShadow: '0 1px 24px rgba(34,29,23,0.45)', duration: 0.5, ease: 'power1.inOut' }, 0.65)
      .to('.video-container', { '--shade': 0.3, duration: 0.6, ease: 'none' }, 0.7)"""),
]


def patch_home_video(path='index.html'):
    try:
        text = open(path, encoding='utf-8').read()
    except FileNotFoundError:
        return
    if HOME_VIDEO_MARK in text:
        return
    missing = [old[:60] for old, _ in HOME_VIDEO_EDITS if old not in text]
    if missing:
        print('homepage video patch skipped; Webflow markup changed near:', missing)
        return
    for old, new in HOME_VIDEO_EDITS:
        text = text.replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write(text)
    print('patched', path, '(single-line video caption)')


patch_home_video()


# --- First-party analytics: the tracking script on every public page (added 2026-10-28) ---
TRACKER_TAG = '<script defer src="/js/a.js"></script>'
NO_TRACKER = {'401.html', 'design-system.html'}


def add_tracker():
    import glob
    for path in sorted(glob.glob('*.html')):
        if path in NO_TRACKER:
            continue
        text = open(path, encoding='utf-8').read()
        if TRACKER_TAG in text or '</head>' not in text:
            continue
        open(path, 'w', encoding='utf-8').write(text.replace('</head>', '  ' + TRACKER_TAG + '\n</head>', 1))
        print('added analytics to', path)


add_tracker()


# --- /investors is the hand-built investment brief, not the Webflow page (2026-10-29) ---
def check_investors():
    try:
        text = open('investors.html', encoding='utf-8').read()
    except FileNotFoundError:
        return
    if 'data-wf-page' in text:
        print('WARNING: the Webflow export replaced investors.html. Restore the brief with: git checkout HEAD -- investors.html')


check_investors()
