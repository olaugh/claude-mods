import type { EngineInterface } from 'claude-code'

// Installing MAGPIE for the mod: its executable (downloaded where one is
// published for the computer, else built from its source), then its data,
// which MAGPIE fetches itself, then the word map of the person's lexicon.

/** The MAGPIE release the mod installs. */
export const MAGPIE_VERSION = '0.1.3'
const RELEASES = 'https://github.com/jvc56/MAGPIE/releases/download'
const SOURCE = `https://github.com/jvc56/MAGPIE/archive/refs/tags/v${MAGPIE_VERSION}.tar.gz`
// The folder the source tarball unpacks to.
const SOURCE_FOLDER = `MAGPIE-${MAGPIE_VERSION}`

export type Os = 'macos' | 'linux' | 'windows'
export type Arch = 'x64' | 'arm64'
export type Host = { os: Os; arch: Arch }

// The executables published for MAGPIE_VERSION, with the SHA-256 published
// beside each. A computer with none builds MAGPIE from its source.
const EXECUTABLES: Partial<Record<`${Os}-${Arch}`, { file: string; sha256: string }>> = {
  'windows-x64': {
    file: `magpie-${MAGPIE_VERSION}-windows-x64.exe`,
    sha256: '2d493ebd0f76b435bf26679d8e4c40d426ebf6906e596b4b69b47d1279b84ee6',
  },
  'windows-arm64': {
    file: `magpie-${MAGPIE_VERSION}-windows-arm64.exe`,
    sha256: '5aae3aa75c4ac982553e1f44fc5b6312aea444f35b54075f5ebf8761f5cd9610',
  },
}

/** Whether an executable is published for the computer; if not, MAGPIE is
 * built from its source there. */
export function isPublished(host: Host): boolean {
  return EXECUTABLES[`${host.os}-${host.arch}`] !== undefined
}

/** The languages MAGPIE plays in, each by its own name and its English one,
 * with its lexicons (the ones MAGPIE's data holds), newest and most played
 * first. */
export const LANGUAGES: readonly { name: string; english: string; lexica: readonly string[] }[] = [
  {
    name: 'English',
    english: 'English',
    lexica: ['CSW24', 'NWL23', 'CSW21', 'NWL20', 'TWL14', 'CSW15', 'TWL06', 'CSW12', 'CSW07', 'TWL98', 'OSWI', 'OSW4', 'OSW3', 'OSW2', 'OSW1'],
  },
  { name: 'Français', english: 'French', lexica: ['FRA20'] },
  { name: 'Deutsch', english: 'German', lexica: ['RD29'] },
  { name: 'Nederlands', english: 'Dutch', lexica: ['DSW25'] },
  { name: 'Català', english: 'Catalan', lexica: ['DISC2'] },
  { name: 'Polski', english: 'Polish', lexica: ['OSPS49'] },
]

/** A language's English name, English for one not listed. */
export function englishNameOf(language: string): string {
  return LANGUAGES.find(candidate => candidate.name === language)?.english ?? 'English'
}

/** The language a lexicon is in, English for one not listed. */
export function languageOf(lexicon: string): string {
  return LANGUAGES.find(language => language.lexica.includes(lexicon.toUpperCase()))?.name ?? 'English'
}

/** A language's first lexicon, CSW24 for one not listed. */
export function firstLexicon(language: string): string {
  return LANGUAGES.find(candidate => candidate.name === language)?.lexica[0] ?? 'CSW24'
}

/** Whether MAGPIE builds a word map for the lexicon: Polish has none. */
export function hasWordmap(lexicon: string): boolean {
  return !/^OSPS/i.test(lexicon)
}

/** The computer the session runs on. */
export async function hostOf($: EngineInterface): Promise<Host> {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    // A 32-bit process on 64-bit Windows sees the machine's in the first.
    const arch = (await $.env.get('PROCESSOR_ARCHITEW6432')) ?? (await $.env.get('PROCESSOR_ARCHITECTURE')) ?? ''
    return { os: 'windows', arch: /arm64/i.test(arch) ? 'arm64' : 'x64' }
  }
  const { stdout } = await $.process.run(['uname', '-sm'])
  const [kernel = '', machine = ''] = stdout.trim().split(/\s+/)
  return { os: kernel === 'Darwin' ? 'macos' : 'linux', arch: /arm64|aarch64/i.test(machine) ? 'arm64' : 'x64' }
}

/** The person's home folder: HOME, or on Windows USERPROFILE. */
export async function homeOf($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

/** Where the mod installs MAGPIE unless told otherwise: on Windows the folder
 * MAGPIE itself looks in (%LOCALAPPDATA%\MAGPIE), elsewhere ~/.magpie. */
export async function defaultMagpieDir($: EngineInterface, host: Host): Promise<string> {
  const local = host.os === 'windows' ? await $.env.get('LOCALAPPDATA') : undefined
  return local === undefined || local === '' ? `${await homeOf($)}/.magpie` : `${local}\\MAGPIE`
}

/** The executable in a MAGPIE folder. */
export function executableIn(dir: string, host: Host): string {
  return `${dir}/bin/magpie${host.os === 'windows' ? '.exe' : ''}`
}

/** A step of the install, as the setup pane lists it. */
export type SetupStep = {
  key: 'magpie' | 'data' | 'wordmap'
  label: string
  state: 'waiting' | 'running' | 'done' | 'failed'
  detail: string
}

/** How the install goes: its steps, and why it stopped, with what the pane
 * offers to do about it (`tools`: install Apple's command-line tools); once
 * done, how saving the choices went. */
export type SetupProgress = {
  steps: SetupStep[]
  problem: string
  remedy?: 'tools'
  isRunning: boolean
  isDone: boolean
  saved?: string
}

export type SetupPlan = { host: Host; dir: string; lexicon: string; threads: number }

/** A stop the person can do something about: what, and what the pane offers. */
class SetupProblem extends Error {
  readonly remedy?: 'tools'

  constructor(message: string, remedy?: 'tools') {
    super(message)
    this.remedy = remedy
  }
}

export function setupSteps(plan: SetupPlan): SetupStep[] {
  return [
    { key: 'magpie', label: `MAGPIE ${MAGPIE_VERSION}`, state: 'waiting', detail: '' },
    { key: 'data', label: 'Word lists and strategy files (about 195 MB)', state: 'waiting', detail: '' },
    { key: 'wordmap', label: `The ${plan.lexicon} word map`, state: 'waiting', detail: '' },
  ]
}

/** Installs what the plan's folder lacks, one step after another, telling
 * `report` each change. Resolves whether it all went. */
export async function installMagpie(
  $: EngineInterface,
  plan: SetupPlan,
  report: (progress: SetupProgress) => Promise<void>,
): Promise<boolean> {
  const progress: SetupProgress = { steps: setupSteps(plan), problem: '', isRunning: true, isDone: false }
  const tell = () => report({ ...progress, steps: progress.steps.map(step => ({ ...step })) })
  let current: SetupStep | undefined
  const step = async (key: SetupStep['key'], work: (say: (detail: string) => Promise<void>) => Promise<void>) => {
    current = progress.steps.find(candidate => candidate.key === key)
    if (current === undefined) {
      return
    }
    const shown = current
    shown.state = 'running'
    await tell()
    await work(async detail => {
      shown.detail = detail
      await tell()
    })
    shown.state = 'done'
    await tell()
  }
  try {
    await step('magpie', say => getExecutable($, plan, say))
    await step('data', say => getData($, plan, say))
    await step('wordmap', say => buildWordmap($, plan, say))
    progress.isDone = true
  } catch (error) {
    if (current !== undefined) {
      current.state = 'failed'
    }
    progress.problem = error instanceof Error ? error.message : String(error)
    if (error instanceof SetupProblem && error.remedy !== undefined) {
      progress.remedy = error.remedy
    }
  }
  progress.isRunning = false
  await tell()
  return progress.isDone
}

// A command that must succeed; its error output is the reason when not.
async function mustRun($: EngineInterface, argv: readonly string[], what: string, cwd?: string): Promise<string> {
  const result = await $.process.run(argv, { cwd, timeoutMs: 600_000 }).catch((error: unknown) => {
    throw new Error(`could not ${what}: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (result.exitCode !== 0) {
    const said = `${result.stderr}\n${result.stdout}`.trim().split('\n').slice(-3).join(' ')
    throw new Error(`could not ${what}${said === '' ? '' : `: ${said}`}`)
  }
  return result.stdout
}

/** A path as Windows' own commands take it. */
export const windowsPath = (path: string) => path.replaceAll('/', '\\')

async function sha256Of($: EngineInterface, host: Host, path: string): Promise<string> {
  if (host.os === 'windows') {
    // certutil prints the hash on a line of its own, spaced on old Windows.
    const said = await mustRun($, ['certutil', '-hashfile', windowsPath(path), 'SHA256'], 'check the download')
    return (said.split('\n').map(line => line.replace(/\s/g, '')).find(line => /^[0-9a-f]{64}$/i.test(line)) ?? '').toLowerCase()
  }
  const said = await mustRun($, host.os === 'macos' ? ['shasum', '-a', '256', path] : ['sha256sum', path], 'check the download')
  return said.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

async function remove($: EngineInterface, host: Host, path: string) {
  await $.process
    .run(host.os === 'windows' ? ['cmd', '/d', '/c', 'del', '/f', '/q', windowsPath(path)] : ['rm', '-f', path])
    .catch(() => undefined)
}

async function getExecutable($: EngineInterface, plan: SetupPlan, say: (detail: string) => Promise<void>) {
  const executable = executableIn(plan.dir, plan.host)
  if (await $.fs.exists(executable)) {
    await say(`already in ${plan.dir}`)
    return
  }
  const published = EXECUTABLES[`${plan.host.os}-${plan.host.arch}`]
  if (published === undefined) {
    await buildFromSource($, plan, say)
    return
  }
  await say(`downloading ${published.file}`)
  await mustRun($, ['curl', '-fsSL', '--create-dirs', '-o', executable, `${RELEASES}/v${MAGPIE_VERSION}/${published.file}`], 'download MAGPIE')
  const sha256 = await sha256Of($, plan.host, executable)
  if (sha256 !== published.sha256) {
    await remove($, plan.host, executable)
    throw new Error(`the download of ${published.file} is not the one published (SHA-256 ${sha256 || 'unknown'}), so it was deleted`)
  }
  await say(`downloaded to ${plan.dir}`)
}

// What building needs, said plainly when it is missing.
async function checkTools($: EngineInterface, host: Host) {
  if (host.os === 'macos') {
    const tools = await $.process.run(['xcode-select', '-p']).catch(() => undefined)
    if (tools?.exitCode !== 0) {
      throw new SetupProblem(
        "No MAGPIE is published for Macs yet, so it is built here, which needs Apple's command-line tools. Press Get the tools, finish Apple's installer, then press Install again.",
        'tools',
      )
    }
    return
  }
  const found = await $.process
    .run(['sh', '-c', 'command -v make && command -v cc && command -v curl && command -v tar'])
    .catch(() => undefined)
  if (found?.exitCode !== 0) {
    throw new SetupProblem(
      'No MAGPIE is published for Linux yet, so it is built here, which needs make, a C compiler, curl and tar. On Debian or Ubuntu: sudo apt install build-essential curl. On Fedora: sudo dnf install make gcc curl tar. Then press Install again.',
    )
  }
}

// One `make` of MAGPIE, telling how many files it has compiled. Resolves
// whether it built, and the last of what it said.
async function make(
  $: EngineInterface,
  source: string,
  targets: readonly string[],
  say: (detail: string) => Promise<void>,
): Promise<{ isBuilt: boolean; said: string }> {
  let said = ''
  let compiled = 0
  const stream = $.process.spawn({ argv: ['make', ...targets], cwd: source })
  for await (const { text } of stream) {
    said = `${said}${text}`.slice(-4000)
    const count = text.split('\n').filter(line => / -c /.test(line)).length
    if (count > 0) {
      compiled += count
      await say(`building: ${compiled} files compiled`)
    }
    if (/-o bin\/magpie\b/.test(text)) {
      await say(`building: ${compiled} files compiled, now linking (the slow part)`)
    }
  }
  const { code } = await stream.result
  return { isBuilt: code === 0, said }
}

async function buildFromSource($: EngineInterface, plan: SetupPlan, say: (detail: string) => Promise<void>) {
  await checkTools($, plan.host)
  const work = `${plan.dir}/build`
  const tarball = `${work}/magpie-${MAGPIE_VERSION}.tar.gz`
  const source = `${work}/${SOURCE_FOLDER}`
  await say('downloading the source')
  await mustRun($, ['curl', '-fsSL', '--create-dirs', '-o', tarball, SOURCE], 'download the source')
  await mustRun($, ['tar', '-xzf', tarball, '-C', work], 'unpack the source')
  await say('building (about a minute)')
  // The build for this very computer, or failing that the portable one the
  // published executables are.
  let build = await make($, source, ['magpie', 'BUILD=no_pgo_release'], say)
  if (!build.isBuilt) {
    await say('building again, the portable way')
    const march = plan.host.arch === 'arm64' ? 'armv8-a' : 'nehalem'
    build = await make($, source, ['magpie', 'BUILD=portable_release', `PORTABLE_MARCH=${march}`], say)
  }
  if (!build.isBuilt) {
    const why = build.said.trim().split('\n').filter(line => /error/i.test(line)).slice(-2).join(' ')
    throw new Error(`MAGPIE did not build${why === '' ? '' : `: ${why}`}`)
  }
  await mustRun($, ['mkdir', '-p', `${plan.dir}/bin`], 'make the bin folder')
  await mustRun($, ['cp', `${source}/bin/magpie`, executableIn(plan.dir, plan.host)], 'put MAGPIE in place')
  await $.process.run(['rm', '-rf', work]).catch(() => undefined)
  await say(`built in ${plan.dir}`)
}

// MAGPIE's own fetch: every language's word lists, each chunk checked
// against its SHA-256, unpacked file by file.
async function getData($: EngineInterface, plan: SetupPlan, say: (detail: string) => Promise<void>) {
  const kwg = `${plan.dir}/data/lexica/${plan.lexicon}.kwg`
  if (await $.fs.exists(kwg)) {
    await say('already there')
    return
  }
  let said = ''
  const stream = $.process.spawn({ argv: [executableIn(plan.dir, plan.host), 'data', 'fetch'], cwd: plan.dir })
  for await (const { text } of stream) {
    said = `${said}${text}`.slice(-4000)
    const line = said.replaceAll('\r', '\n').trim().split('\n').at(-1)?.trim()
    if (line !== undefined && line !== '') {
      await say(line)
    }
  }
  const { code } = await stream.result
  if (code !== 0) {
    const why = said.trim().split('\n').slice(-2).join(' ')
    throw new Error(`the data did not download (exit ${code})${why === '' ? '' : `: ${why}`}`)
  }
  if (!(await $.fs.exists(kwg))) {
    throw new Error(`the data downloaded, but holds no ${plan.lexicon}`)
  }
  await say('downloaded')
}

// MAGPIE builds a lexicon's word map the first time it loads it; loading it
// here spares the first sim the wait.
async function buildWordmap($: EngineInterface, plan: SetupPlan, say: (detail: string) => Promise<void>) {
  if (!hasWordmap(plan.lexicon)) {
    await say('none for Polish')
    return
  }
  const wordmap = `${plan.dir}/data/lexica/${plan.lexicon}.wmp`
  if (await $.fs.exists(wordmap)) {
    await say('already built')
    return
  }
  await say('building (a few seconds)')
  const args = ['setoptions', '-lex', plan.lexicon, '-wmp', 'true', '-threads', String(plan.threads)]
  await mustRun($, [executableIn(plan.dir, plan.host), ...args], `build the ${plan.lexicon} word map`, plan.dir)
  if (!(await $.fs.exists(wordmap))) {
    throw new Error(`MAGPIE did not build the ${plan.lexicon} word map`)
  }
  await say('built')
}
