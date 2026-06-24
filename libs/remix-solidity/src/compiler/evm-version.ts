import { EVMVersion } from './types'

/*
 * Coerce the `evmVersion` URL-hash / ConfigurationSettings param.
 *
 * It used to be passed through to the solc Standard JSON input with no
 * validation (only the literal strings 'undefined'/'null' were mapped to null),
 * so #evmVersion=<anything> reached solc and failed the compile with
 * "Invalid EVM version requested". In this build the only supported target is
 * 'tron' (EVMVersion = 'tron' | null); anything unrecognised falls back to null
 * (solc default) so a crafted URL can't break compilation.
 */
export function normalizeEvmVersion (value: unknown): EVMVersion {
  return String(value ?? '').trim().toLowerCase() === 'tron' ? 'tron' : null
}
