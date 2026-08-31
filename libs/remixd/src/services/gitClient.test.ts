import { assertCommand } from './gitClient'

describe('GitClient command policy', () => {
  test('allows safe commands and rejects workspace/config overrides', () => {
    expect(assertCommand('git status --short')).toEqual(['status', '--short'])
    expect(assertCommand('git log --oneline')).toEqual(['log', '--oneline'])
    expect(() => assertCommand('git -C /tmp status')).toThrow(/Unsupported git command/)
    expect(() => assertCommand('git --git-dir=/tmp/repo status')).toThrow(/Unsupported|workspace|configuration/i)
    expect(() => assertCommand('git -c core.sshCommand=evil status')).toThrow(/Unsupported git command/)
    expect(() => assertCommand('git status ../outside')).toThrow(/Unsupported|workspace|configuration/i)
    expect(() => assertCommand('git diff --output=/tmp/leak')).toThrow(/workspace|configuration/i)
    expect(() => assertCommand('git config --global user.name evil')).toThrow(/Unsupported git command/)
  })
})
