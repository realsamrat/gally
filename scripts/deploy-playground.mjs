// Builds the playground and deploys it to Vercel as a static site.
//   npm run deploy:playground            # preview deployment
//   npm run deploy:playground -- --prod  # production
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const run = (command, options = {}) => execSync(command, { stdio: 'inherit', ...options })
// The deployed site serves the benchmark fixtures (gitignored); without them every image 404s.
if (!existsSync('public/fixtures/manifest.json')) {
  console.error('No benchmark fixtures: run `npm run fixtures` first.')
  process.exit(1)
}
run('npm run build:playground')
// API functions (benchmark history in Vercel Blob) and their dependencies.
cpSync('playground/functions', 'playground-dist', { recursive: true })
writeFileSync(
  'playground-dist/vercel.json',
  JSON.stringify(
    {
      // Static files are served as built; there's nothing to build on Vercel.
      buildCommand: '',
      outputDirectory: '.',
      headers: [
        { source: '/fixtures/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }, { key: 'Timing-Allow-Origin', value: '*' }] },
        { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ],
    },
    null,
    2,
  ),
)
// The build empties playground-dist, so the Vercel project link is kept beside it.
const LINK = '.vercel-playground'
if (existsSync(`${LINK}/project.json`)) {
  mkdirSync('playground-dist/.vercel', { recursive: true })
  cpSync(`${LINK}/project.json`, 'playground-dist/.vercel/project.json')
} else {
  run('vercel link --yes --project gally-playground', { cwd: 'playground-dist' })
  mkdirSync(LINK, { recursive: true })
  cpSync('playground-dist/.vercel/project.json', `${LINK}/project.json`)
}
run(`vercel deploy --yes ${process.argv.includes('--prod') ? '--prod' : ''}`, { cwd: 'playground-dist' })
