# t3type

A typing game that looks like T3 Code. You type prompts to coding agents as
Theo, Julius and Maria. The agents take every typo literally.

```bash
npm install
npm run dev      # http://0.0.0.0:5179
npm run build    # static files in dist/, open dist/index.html from any file server
node tests/play.mjs
```

## How to play

- The next prompt shows as gray ghost text in the composer. Type over it. Enter sends, typos included.
- While an agent works, switch to another thread: Tab jumps to the next thread waiting on you,
  Shift+Tab goes back, and Ctrl+Shift+] / Ctrl+Shift+[ (Cmd on macOS) step through the sidebar
  like T3 Code's thread.next and thread.previous.
- A session ends when every thread is done or after 4 minutes.

## Content

Threads come from `../content/research/t3-threads.json`, imported unchanged by
`src/content/prompts.ts`. Prompts marked `real` are verbatim and link to their
post. Everything else is parody and labeled as such.

URL options for testing: `?speed=4` runs the game clock 4x, `?duration=60` sets
the session length in seconds, `?theme=light` or `?theme=dark` forces a theme.

See THIRD_PARTY.md for the T3 Code MIT notice.
