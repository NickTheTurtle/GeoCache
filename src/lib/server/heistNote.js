// The note now served at /heist. The maze itself lives on only in the Wayback
// Machine capture of this URL; the note sends players there (the "machine from
// the Museum"). Like the maze, it is a self-contained page with no scripts.

const PARAGRAPHS = [
  'You’re the most unreliable, worthless piece of rookie meat I’ve ever had the fortune to encounter. I TOLD you to be on time. “Not a second too late,” I said. I even waited an extra 30 minutes for your sorry asses.',
  'Sigh. I can’t believe I’m saying this. There’s one way you can redeem yourself. While scoping the museum, I discovered this truly incredible machine from the Museum, free to the public. Prove to me that there’s something resembling intelligence in those thick skulls of yours. Use that machine and come back here ON TIME.',
];

const CSS = `
*{box-sizing:border-box}
html{background:#f3e7c9;color:#2b1d0e}
body{margin:0;font:18px/1.6 Georgia,"Times New Roman",serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 48px}
.note{background:#fdf8ea;border:1px solid #d9c49a;border-radius:4px;box-shadow:0 3px 14px rgba(60,35,5,.22);padding:36px 32px}
.note p{margin:0 0 1.1em}
.to{font-weight:bold;font-size:1.15em}
.sig{margin-top:1.8em;text-align:right}
.sig strong{display:block;font-size:1.25em;font-style:italic}
.sig span{color:#7a4b12;font-size:.9em}
@media (max-width:480px){body{font-size:17px}.note{padding:24px 20px}}
`;

export function renderHeistNote({ title = 'The Heist' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<article class="note">
<p class="to">Dear idiots,</p>
${PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n')}
<p class="sig"><strong>Flabber Gast</strong><span>September 28th</span></p>
</article>
</main>
</body>
</html>
`;
}
