export type SortKey = 'win' | 'equity' | 'score' | 'static' | 'iterations' | 'play' | 'result' | 'net'

declare module 'claude-code' {
  interface PluginState {
    'magpie-sim': {
      selectedId: string
      sortKey: SortKey
      isDescending: boolean
      windowTop: number
      /** The results file the show tool named; empty for the one the mod ships. */
      simFile: string
      /** The last run's output, which the pane shows over any file; empty
       * before a run. */
      simText: string
      /** What the running sim was asked for; empty when none runs. */
      running: string
      /** Why the last run failed; empty when it did not. */
      runError: string
      /** What the pane shows, as JSON (register.tsx's Current); empty before a run. */
      current: string
      /** How the install goes, as JSON (setup.ts's SetupProgress); empty
       * before one starts. */
      setup: string
      /** The language and lexicon the setup pane picked; empty for the
       * mod's options. */
      setupLanguage: string
      setupLexicon: string
    }
  }
}
