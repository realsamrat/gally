import { StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import 'allo-font/allo.css'
import '@fontsource-variable/roboto-mono/wght.css'
import '../styles/gally.css'
import './site.css'
import pkg from '../package.json'
import { CanvasDemo, HybridDemo, LibraryDemo } from './demos'
import { LayersFigure, LodFigure, RendererFigure, WindowFigure } from './figures'
import { CopyButton, GitHubIcon, Icon, Reveal } from './ui'

const SLUG = 'realsamrat/gally'
const REPO = `https://github.com/${SLUG}`
const INSTALLS = {
  npm: `npm install github:${SLUG}`,
  pnpm: `pnpm add github:${SLUG}`,
  yarn: `yarn add gally@github:${SLUG}`,
  bun: `bun add github:${SLUG}`,
}
type Manager = keyof typeof INSTALLS
const INSTALL = INSTALLS.npm

const SAMPLES = {
  canvas: `import { GallyCanvas } from "gally/react"
import "gally/styles.css"

export function Portfolio({ photos }) {
  return (
    <GallyCanvas
      photos={photos}
      theme={{ background: "dotted" }}
      onSelectPhoto={({ photo }) => openLightbox(photo)}
    />
  )
}`,
  hybrid: `import { GallyHybridCanvas } from "gally/react"
import "gally/styles.css"

export function Archive({ photos }) {
  return (
    <GallyHybridCanvas
      photos={photos}
      overviewZoom={0.56} // paint below this
      detailZoom={0.72} // elements above this
      onSelectPhoto={({ photo }) => openLightbox(photo)}
    />
  )
}`,
  library: `import { GallyLibrary } from "gally/react"
import "gally/styles.css"

export function Library({ photos }) {
  return (
    <GallyLibrary
      photos={photos}
      fit="square"
      initialScroll="end"
      onOpenPhoto={({ index }) => openViewer(index)}
    />
  )
}`,
}

type Sample = keyof typeof SAMPLES

const TOKEN = /(\/\/.*$)|("[^"]*")|\b(import|from|export|function|return)\b|(<\/?[A-Z][A-Za-z]*|\/>)|(\b[a-zA-Z]+(?==))/gm
const TOKEN_CLASS = ['', 'c', 's', 'k', 't', 'a']

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of code.matchAll(TOKEN)) {
    if (match.index > last) out.push(code.slice(last, match.index))
    const group = match.findIndex((value, index) => index > 0 && value !== undefined)
    out.push(
      <span key={match.index} className={TOKEN_CLASS[group]}>
        {match[0]}
      </span>,
    )
    last = match.index + match[0].length
  }
  out.push(code.slice(last))
  return out
}

const SAMPLE_NAMES: Record<Sample, string> = { canvas: 'Canvas', hybrid: 'Hybrid', library: 'Library' }

/** A code box: tabs and a copy button in its header, the code on a darker pane below. */
function CodeBox<T extends string>({ label, tabs, value, onChange, text, children }: { label: string; tabs: Array<[T, string]>; value: T; onChange: (value: T) => void; text: string; children: ReactNode }) {
  return (
    <div className="code">
      <div className="code__head">
        <Icon name="file" />
        <div role="group" aria-label={label}>
          {tabs.map(([key, name]) => (
            <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
              {name}
            </button>
          ))}
        </div>
        <CopyButton text={text} label="Copy" className="tool" />
      </div>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </div>
  )
}

function Usage() {
  const [manager, setManager] = useState<Manager>('npm')
  const [sample, setSample] = useState<Sample>('canvas')
  return (
    <>
      <CodeBox label="Package manager" tabs={(Object.keys(INSTALLS) as Manager[]).map((key) => [key, key])} value={manager} onChange={setManager} text={INSTALLS[manager]}>
        {INSTALLS[manager]}
      </CodeBox>
      <CodeBox label="Component" tabs={(Object.keys(SAMPLES) as Sample[]).map((key) => [key, SAMPLE_NAMES[key]])} value={sample} onChange={setSample} text={SAMPLES[sample]}>
        {highlight(SAMPLES[sample])}
      </CodeBox>
    </>
  )
}

function Heading({ children, tag }: { children: ReactNode; tag?: string }) {
  return (
    <h2>
      <span>{children}</span>
      {tag && <code>{tag}</code>}
    </h2>
  )
}

function Page() {
  return (
    <main>
      <header className="masthead enter" style={{ '--n': 0 } as React.CSSProperties}>
        <div>
          <h1>Gally</h1>
          <p>Photo-first infinite canvas</p>
        </div>
        <nav aria-label="Links">
          <CopyButton text={INSTALL} label="Copy install command" className="tool" />
          <a className="tool" href={REPO} aria-label="Gally on GitHub" title="GitHub">
            <GitHubIcon />
          </a>
        </nav>
      </header>

      <div className="prose enter" style={{ '--n': 1 } as React.CSSProperties}>
        <p>
          Most photo galleries are pages. You scroll, you click, you go back. I wanted one you could move through, so I built Gally: a small engine that
          puts photos on a surface you can drag and pinch, and keeps it smooth when there are thousands of them.
        </p>
        <p>It comes as three React components. Each demo below is the component itself, so go ahead and touch it.</p>
      </div>

      <section className="enter" style={{ '--n': 2 } as React.CSSProperties}>
        <Heading tag="GallyCanvas">Canvas</Heading>
        <p>
          A wall of photos with no edge. The rows repeat in every direction, so you can drag forever and never reach the end. I'd use it for a portfolio
          home, where wandering is the point.
        </p>
        <CanvasDemo />
      </section>

      <Reveal as="section">
        <Heading tag="GallyHybridCanvas">Hybrid Canvas</Heading>
        <p>
          The same wall, built for more photos. Up close, each photo is a real element you can hover, focus and click. Zoom out and Gally stops making
          elements and paints everything onto one canvas, like a contact sheet. I'd use it for an archive, where you want to see everything and then
          one thing.
        </p>
        <HybridDemo />
      </Reveal>

      <Reveal as="section">
        <Heading tag="GallyLibrary">Library</Heading>
        <p>
          Photos in order, on a grid. Pinch and the columns snap from one size to the next, the way they do in the Photos app on a phone. I'd use it
          for a camera roll or a client gallery, anything where the order matters.
        </p>
        <LibraryDemo />
      </Reveal>

      <Reveal as="section">
        <Heading>How It Works</Heading>
        <p>
          None of these ideas are new. Cameras, culling and level of detail are how maps and games have worked for years. Gally's part is shaping them
          around photos.
        </p>
        <LayersFigure />
      </Reveal>

      <Reveal as="section">
        <Heading>The Camera</Heading>
        <p>
          Photos never move. Each one has a fixed place in a world, and the camera is three numbers: x, y and zoom. Panning changes the numbers and
          slides one layer, so React is never asked to move a thousand tiles.
        </p>
        <WindowFigure />
      </Reveal>

      <Reveal as="section">
        <Heading>Just Enough Pixels</Heading>
        <p>
          Each photo comes in a few sizes. Small tiles get small files, and what's on screen loads before what's near it. Anything you've already
          passed is dropped from the queue.
        </p>
        <LodFigure />
      </Reveal>

      <Reveal as="section">
        <Heading>Canvas or Elements</Heading>
        <p>
          A few hundred elements are fine. A few thousand aren't. So the hybrid canvas keeps two renderers over the same photos and picks one by zoom.
        </p>
        <RendererFigure />
        <p>
          To see this on the real thing, press Debug on any demo above. Blue outlines are elements. Orange is canvas.
        </p>
      </Reveal>

      <Reveal as="section">
        <Heading>Use It</Heading>
        <p>Gally is in alpha, so for now it installs from GitHub.</p>
        <Usage />
        <p>Gally draws the photos and handles the gestures. The header, the lightbox and the routes stay yours.</p>
      </Reveal>

      <Reveal as="footer" className="colophon">
        <div className="colophon__top">
          <a className="byline" href="https://x.com/realsamratc">
            <img src="/samrat.jpg" alt="" width="20" height="20" />
            <span>
              Made by <b>Samrat Chowdhury</b>
            </span>
          </a>
          <p>
            <a href={REPO}>GitHub</a>
            <span>v{pkg.version}</span>
            <span>MIT</span>
          </p>
        </div>
        <dl>
          <div>
            <dt>Page design</dt>
            <dd>
              Inspired by <a href="https://x.com/raphaelsalaja">Raphael Salaja</a>
            </dd>
          </div>
          <div>
            <dt>Typeface</dt>
            <dd>
              <a href="https://allo.joshpuckett.me">Allo</a>
            </dd>
          </div>
          <div>
            <dt>Photos</dt>
            <dd>
              <a href="https://picsum.photos">Lorem Picsum</a>
            </dd>
          </div>
        </dl>
      </Reveal>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
