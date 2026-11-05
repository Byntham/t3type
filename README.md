<img src="assets/icon.svg" width="64" height="64" alt="">

# t3type

A typing game that looks like T3 Code. You type prompts to coding agents as
Theo, Julius and Maria.

```bash
npm install
npm run dev      # http://0.0.0.0:5179
npm run build    # static files in dist/, open dist/index.html from any file server
npm run lint     # fails on any code comment
npm run test:unit
npm test         # unit tests, then the Playwright play test
```

`npm test` starts its own Vite server on port 5180. To test a running server
instead, set `T3TYPE_URL`, for example `T3TYPE_URL=http://gibo:5179/ npm test`.

## No code comments

`npm run lint` rejects comments in TypeScript, JavaScript, CSS and HTML. If code
needs explaining, give it a clearer name or write a test. CI runs the lint on
every push and pull request.

## How to play

- The next prompt shows as gray ghost text in the composer. Type over it. Wrong keys show in red
  until you backspace and fix them.
- When every character is right, the prompt turns green and locks. Press Enter to send it.
- While an agent works, switch to another thread: Tab jumps to the next thread waiting on you,
  Shift+Tab goes back, and Ctrl+Shift+] / Ctrl+Shift+[ (Cmd on macOS) step through the sidebar
  like T3 Code's thread.next and thread.previous.
- Every prompt is its own WPM test, timed from its first key to its last. Time spent in other
  threads does not count. Each sent message shows its WPM and accuracy.
- A session ends when every thread is done.

## Content

Threads come from `content/threads.json`, imported unchanged by
`src/content/prompts.ts`. Prompts marked `real` are verbatim and link to their
post. Everything else is parody and labeled as such.

URL options for testing: `?speed=4` runs the agents 4x faster, `?seed=N` replays
the same thread draw, `?core=N` and `?guests=N` set how many threads come from
each core persona and from mutuals, `?theme=light` or `?theme=dark` forces a theme.

See THIRD_PARTY.md for the T3 Code MIT notice.
