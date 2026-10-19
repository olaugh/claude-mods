import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { firstLexicon, languageOf } from '../hooks/setup'

const WINDOWS = {
  env: {
    OS: 'Windows_NT',
    PROCESSOR_ARCHITECTURE: 'ARM64',
    USERPROFILE: 'C:\\Users\\test',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    NUMBER_OF_PROCESSORS: '8',
  },
  uname: '',
}
const MAC = { env: { HOME: '/Users/test' }, uname: 'Darwin arm64' }
const LINUX = { env: { HOME: '/home/test' }, uname: 'Linux x86_64' }
const WINDOWS_DIR = 'C:\\Users\\test\\AppData\\Local\\MAGPIE'
const WINDOWS_EXE = `${WINDOWS_DIR}/bin/magpie.exe`
const MAC_DIR = '/Users/test/.magpie'
const ARM64_SHA256 = '5aae3aa75c4ac982553e1f44fc5b6312aea444f35b54075f5ebf8761f5cd9610'

type Run = { argv: readonly string[]; cwd?: string }

// Stands in for the computer the mod installs on: its environment, which
// files are there (`present`, which each command adds to as it would), what
// the commands say, and how `make` goes (`builds`, an exit code per run).
// Records the commands run (not the ones reading the computer), the options
// saved and the panes opened and closed.
function installHost(
  on: On,
  machine: { env: Record<string, string>; uname: string },
  {
    present = new Set<string>(),
    sha256 = ARM64_SHA256,
    hasTools = true,
    builds = [0],
  }: { present?: Set<string>; sha256?: string; hasTools?: boolean; builds?: number[] } = {},
) {
  const runs: Run[] = []
  const saved: string[] = []
  const panes: string[] = []
  mock.env(on, machine.env)
  mock.store(on)
  // The kit takes a Windows path as relative, run on a Mac or Linux: from
  // its drive letter is the path asked about.
  on('fs.exists', (_$, e) => ({ value: present.has(e.path.replace(/^.*?(?=[A-Z]:\\)/, '')) }) as never)
  on('process.run', (_$, e) => {
    const [command = '', ...args] = e.argv
    let exitCode = 0
    let stdout = ''
    if (command === 'uname') {
      stdout = `${machine.uname}\n`
    } else if (command === 'getconf') {
      stdout = '12\n'
    } else {
      runs.push({ argv: e.argv, cwd: e.init?.cwd })
    }
    if (command === 'curl') {
      present.add(args[args.indexOf('-o') + 1] ?? '')
    } else if (command === 'certutil') {
      // Old Windows spaces the hash out.
      stdout = `SHA256 hash of ${args[1]}:\r\n${sha256.replace(/(..)/g, '$1 ').trim()}\r\nCertUtil: -hashfile command completed successfully.\r\n`
    } else if (command === 'xcode-select' && args[0] === '-p') {
      exitCode = hasTools ? 0 : 2
    } else if (command === 'cp') {
      present.add(args[1] ?? '')
    } else if (args[0] === 'setoptions') {
      present.add(`${e.init?.cwd}/data/lexica/${args[args.indexOf('-lex') + 1]}.wmp`)
    }
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[]; cwd?: string }) {
    runs.push({ argv: e.argv, cwd: e.cwd })
    if (e.argv[0] === 'make') {
      yield { stream: 'stdout' as const, text: 'mkdir -p obj\ncc -O3 -c src/a.c -o obj/a.o\ncc -O3 -c src/b.c -o obj/b.o\n' }
      return { value: { code: builds.shift() ?? 0, signal: null } }
    }
    yield { stream: 'stdout' as const, text: 'downloading the data, part 1 of 5 (40 MB)\n' }
    yield { stream: 'stdout' as const, text: 'unpacking the data into ./data\nunpacked 127 files\n' }
    present.add(`${e.cwd}/data/lexica`)
    for (const lexicon of ['CSW24', 'NWL23', 'RD29']) {
      present.add(`${e.cwd}/data/lexica/${lexicon}.kwg`)
    }
    return { value: { code: 0, signal: null } }
  } as never)
  on('config.set', (_$, e) => {
    saved.push(`${e.key}=${String(e.value)}`)
    return { value: e.value } as never
  })
  on('ui.open', (_$, e) => {
    panes.push(`open ${e.id}`)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    panes.push(`close ${e.id}`)
    return { value: undefined } as never
  })
  return { runs, saved, panes }
}

const mountSetup = ($: Engine) =>
  $.ui.mount({
    plugin: 'magpie-sim',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'magpie-setup',
    props: { title: 'MAGPIE setup', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })

// The lines of text the pane shows now.
async function shown(ui: Awaited<ReturnType<typeof mountSetup>>): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(text => text.text ?? '')
}

// The language and lexicon the pane shows chosen.
async function chosen(ui: Awaited<ReturnType<typeof mountSetup>>): Promise<(string | undefined)[]> {
  return (await ui.findAll({ type: 'Text' })).filter(text => text.props?.backgroundColor !== undefined).map(text => text.text?.trim())
}

test('each language starts at its first lexicon, and a lexicon knows its language', () => {
  expect(firstLexicon('Deutsch')).toBe('RD29')
  expect(firstLexicon('English')).toBe('CSW24')
  expect(languageOf('nwl23')).toBe('English')
  expect(languageOf('OSPS49')).toBe('Polski')
})

test('the setup pane picks a language, then one of its lexicons', async ($, on) => {
  installHost(on, LINUX)
  const ui = await mountSetup($)
  const text = (await shown(ui)).join('\n')
  expect(text).toContain('MAGPIE runs the sims, and it is not installed yet.')
  expect(text).toContain('it builds MAGPIE 0.1.3 from its source (about a minute)')
  expect(text).toContain('/home/test/.magpie')
  expect(await chosen(ui)).toEqual(['English', 'CSW24'])
  await ui.press({ key: 'language-Deutsch' })
  expect(await chosen(ui)).toEqual(['Deutsch', 'RD29'])
  await ui.press({ key: 'language-English' })
  expect(await chosen(ui)).toEqual(['English', 'CSW24'])
  await ui.press({ key: 'lexicon-NWL23' })
  expect(await chosen(ui)).toEqual(['English', 'NWL23'])
  await ui.unmount()
})

test('on Windows, Install downloads the published executable and checks it, then MAGPIE fetches its data and builds the word map', async ($, on) => {
  const { runs, saved } = installHost(on, WINDOWS)
  const ui = await mountSetup($)
  expect((await shown(ui)).join('\n')).toContain('it downloads MAGPIE 0.1.3, then its word lists')
  await ui.press({ key: 'language-Deutsch' })
  await ui.press({ key: 'install' })
  expect(runs).toEqual([
    {
      argv: [
        'curl',
        '-fsSL',
        '--create-dirs',
        '-o',
        WINDOWS_EXE,
        'https://github.com/jvc56/MAGPIE/releases/download/v0.1.3/magpie-0.1.3-windows-arm64.exe',
      ],
    },
    { argv: ['certutil', '-hashfile', 'C:\\Users\\test\\AppData\\Local\\MAGPIE\\bin\\magpie.exe', 'SHA256'] },
    { argv: [WINDOWS_EXE, 'data', 'fetch'], cwd: WINDOWS_DIR },
    { argv: [WINDOWS_EXE, 'setoptions', '-lex', 'RD29', '-wmp', 'true', '-threads', '6'], cwd: WINDOWS_DIR },
  ])
  const text = (await shown(ui)).join('\n')
  expect(text).toContain(`✓ MAGPIE 0.1.3  downloaded to ${WINDOWS_DIR}`)
  expect(text).toContain('✓ Word lists and strategy files (about 195 MB)  downloaded')
  expect(text).toContain('✓ The RD29 word map  built')
  expect(text).toContain('MAGPIE is ready, in RD29.')
  // Kept as the mod's options; installed now, the pane offers to save.
  expect(saved).toEqual(['magpie-sim.language=Deutsch', 'magpie-sim.lexicon=RD29'])
  expect(await ui.find({ type: 'Button', key: 'install' })).toBeDefined()
  expect(text).toContain(`MAGPIE is installed in ${WINDOWS_DIR}.`)
  await ui.unmount()
})

test('a download that is not the one published is deleted, and the install stops', async ($, on) => {
  const { runs, saved } = installHost(on, WINDOWS, { sha256: '0'.repeat(64) })
  const ui = await mountSetup($)
  await ui.press({ key: 'install' })
  expect(runs.at(-1)?.argv).toEqual(['cmd', '/d', '/c', 'del', '/f', '/q', 'C:\\Users\\test\\AppData\\Local\\MAGPIE\\bin\\magpie.exe'])
  const text = (await shown(ui)).join('\n')
  expect(text).toContain('✗ MAGPIE 0.1.3')
  expect(text).toContain('the download of magpie-0.1.3-windows-arm64.exe is not the one published')
  expect(text).toContain('· The CSW24 word map')
  expect(saved).toEqual([])
  await ui.unmount()
})

test("on a Mac without Apple's command-line tools, Install says how to get them and offers to", async ($, on) => {
  const { runs } = installHost(on, MAC, { hasTools: false })
  const ui = await mountSetup($)
  await ui.press({ key: 'install' })
  expect((await shown(ui)).join('\n')).toContain("which needs Apple's command-line tools. Press Get the tools")
  await ui.press({ key: 'tools' })
  expect(runs.map(run => run.argv.join(' '))).toEqual(['xcode-select -p', 'xcode-select --install'])
  await ui.unmount()
})

test('on a Mac MAGPIE is built from its source, the portable way when the native build fails', async ($, on) => {
  const { runs } = installHost(on, MAC, { builds: [2, 0] })
  const ui = await mountSetup($)
  await ui.press({ key: 'lexicon-NWL23' })
  await ui.press({ key: 'install' })
  const source = `${MAC_DIR}/build/MAGPIE-0.1.3`
  expect(runs.map(run => [run.argv.join(' '), run.cwd ?? ''])).toEqual([
    ['xcode-select -p', ''],
    [`curl -fsSL --create-dirs -o ${MAC_DIR}/build/magpie-0.1.3.tar.gz https://github.com/jvc56/MAGPIE/archive/refs/tags/v0.1.3.tar.gz`, ''],
    [`tar -xzf ${MAC_DIR}/build/magpie-0.1.3.tar.gz -C ${MAC_DIR}/build`, ''],
    ['make magpie BUILD=no_pgo_release', source],
    ['make magpie BUILD=portable_release PORTABLE_MARCH=armv8-a', source],
    [`mkdir -p ${MAC_DIR}/bin`, ''],
    [`cp ${source}/bin/magpie ${MAC_DIR}/bin/magpie`, ''],
    [`rm -rf ${MAC_DIR}/build`, ''],
    [`${MAC_DIR}/bin/magpie data fetch`, MAC_DIR],
    [`${MAC_DIR}/bin/magpie setoptions -lex NWL23 -wmp true -threads 10`, MAC_DIR],
  ])
  expect((await shown(ui)).join('\n')).toContain(`✓ MAGPIE 0.1.3  built in ${MAC_DIR}`)
  await ui.unmount()
})

test('Save keeps what is installed, and Polish has no word map to build', async ($, on) => {
  const present = new Set([`${MAC_DIR}/bin/magpie`, `${MAC_DIR}/data/lexica`, `${MAC_DIR}/data/lexica/OSPS49.kwg`])
  const { runs, saved } = installHost(on, MAC, { present })
  const ui = await mountSetup($)
  expect((await shown(ui)).join('\n')).toContain(`MAGPIE is installed in ${MAC_DIR}. Pick the language and lexicon you play in, then press Save.`)
  await ui.press({ key: 'language-Polski' })
  await ui.press({ key: 'install' })
  expect(runs).toEqual([])
  const text = (await shown(ui)).join('\n')
  expect(text).toContain(`✓ MAGPIE 0.1.3  already in ${MAC_DIR}`)
  expect(text).toContain('✓ Word lists and strategy files (about 195 MB)  already there')
  expect(text).toContain('✓ The OSPS49 word map  none for Polish')
  expect(saved).toEqual(['magpie-sim.language=Polski', 'magpie-sim.lexicon=OSPS49'])
  await ui.unmount()
})

test('Not now closes the setup pane', async ($, on) => {
  const { panes } = installHost(on, LINUX)
  const ui = await mountSetup($)
  await ui.press({ key: 'decline' })
  expect(panes).toEqual(['close magpie-setup'])
  await ui.unmount()
})

test('with MAGPIE missing, /magpie and the simulate tool open the setup pane', async ($, on) => {
  const { panes } = installHost(on, LINUX)
  const { text } = await $.command.run({ command: 'magpie', args: 'aeinrst' } as never)
  expect(text).toBe('MAGPIE, which runs the sims, is not installed yet. Opened the MAGPIE setup pane: press Install there.')
  const result = JSON.stringify(await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: 'AEINRST' } as never))
  expect(result).toContain('Not run: MAGPIE, which runs the sims, is not installed yet.')
  expect(result).toContain('ask the person to press Install there')
  expect(panes).toEqual(['open magpie-setup', 'open magpie-setup'])
})
