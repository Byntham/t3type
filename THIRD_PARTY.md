# Third-party notices

t3type is a parody of T3 Code. Its theme tokens, base styles, Tailwind class
strings, component markup, the T3 wordmark path, and the provider icon paths
were copied or adapted from T3 Code (https://github.com/pingdotgg/t3code),
mainly from these files in `apps/web/src`:

- `index.css`
- `components/AppSidebarLayout.tsx`, `components/ui/sidebar.tsx`
- `components/Sidebar.tsx`, `components/sidebar/*`
- `components/ChatView.tsx`, `components/chat/ChatHeader.tsx`, `components/BranchToolbar*.tsx`
- `components/chat/MessagesTimeline.tsx`, `components/chat/Timeline*.tsx`, `components/chat/WorkLog.tsx`
- `components/chat/ChatComposer.tsx`, `components/chat/ComposerSurface.tsx`,
  `components/chat/ComposerControl.tsx`, `components/chat/ProviderModelPicker.tsx`,
  `components/chat/ComposerPrimaryActions.tsx`, `components/chat/EffortGlyph.tsx`
- `components/T3Wordmark.tsx`, `components/Icons.tsx`, `components/ProjectMonogram.tsx`

T3 Code is distributed under the MIT License:

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Other dependencies (React, Tailwind CSS, lucide-react, Inter via
@fontsource-variable/inter, tailwind-merge, class-variance-authority) keep their
own licenses in `node_modules`.

Prompts marked `kind: "real"` in the game are short quotes from public posts by
Theo (@theo), Julius (@jullerino) and Maria (@maria_rcks). Each one links to
its source. All other prompts and every agent reply are parody.
