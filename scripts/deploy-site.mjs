// Builds the public demo site and deploys it to Vercel as a static site.
//   npm run deploy:site            # preview deployment
//   npm run deploy:site -- --prod  # production
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const PROJECT = 'gallyjs'
const run = (command, options = {}) => execSync(command, { stdio: 'inherit', ...options })
// The site's photos are the fixtures in public/ (gitignored); without them every image 404s.
if (!existsSync('public/fixtures/manifest.json')) {
  console.error('No photos: run `npm run fixtures` first.')
  process.exit(1)
}
run('npm run build:site')
writeFileSync(
  'site-dist/vercel.json',
  JSON.stringify(
    {
      // Static files are served as built; there's nothing to build on Vercel.
      buildCommand: '',
      outputDirectory: '.',
      headers: [
        { source: '/fixtures/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
        { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      ],
    },
    null,
    2,
  ),
)
// The build empties site-dist, so the Vercel project link is kept beside it.
const LINK = '.vercel-site'
if (existsSync(`${LINK}/project.json`)) {
  mkdirSync('site-dist/.vercel', { recursive: true })
  cpSync(`${LINK}/project.json`, 'site-dist/.vercel/project.json')
} else {
  run(`vercel link --yes --project ${PROJECT}`, { cwd: 'site-dist' })
  mkdirSync(LINK, { recursive: true })
  cpSync('site-dist/.vercel/project.json', `${LINK}/project.json`)
}
run(`vercel deploy --yes ${process.argv.includes('--prod') ? '--prod' : ''}`, { cwd: 'site-dist' })
