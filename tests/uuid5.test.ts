import { describe, expect, it } from 'vitest'
import { DERIVE_NAMESPACE, uuidv5 } from '../app/utils/uuid5'

// The namespaces RFC 4122 defines, used here only as known-answer test vectors.
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

describe('uuidv5', () => {
  // Cross-checked against CPython's uuid.uuid5, which is a straight
  // implementation of RFC 4122 section 4.3.
  it('matches a reference implementation', () => {
    expect(uuidv5(DNS_NAMESPACE, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    expect(uuidv5(URL_NAMESPACE, 'http://www.example.com/')).toBe('fcde3c85-2270-590f-9e7c-ee003d65e0e2')
    expect(uuidv5(DERIVE_NAMESPACE, 'entry:line')).toBe('a746bc91-9dc2-5bcb-9206-c80a42850e4b')
  })

  it('sets the version and variant bits', () => {
    const uuid = uuidv5(DERIVE_NAMESPACE, 'entry:line')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is deterministic, which is the whole point', () => {
    const name = 'a1b2c3d4-0000-4000-8000-000000000001:e5f6a7b8-0000-4000-8000-000000000002'
    expect(uuidv5(DERIVE_NAMESPACE, name)).toBe(uuidv5(DERIVE_NAMESPACE, name))
  })

  it('separates names that differ by one character', () => {
    expect(uuidv5(DERIVE_NAMESPACE, 'entry:line-1')).not.toBe(uuidv5(DERIVE_NAMESPACE, 'entry:line-2'))
  })

  it('separates the same name in different namespaces', () => {
    expect(uuidv5(DNS_NAMESPACE, 'shared')).not.toBe(uuidv5(DERIVE_NAMESPACE, 'shared'))
  })

  it('handles names long enough to span several hash blocks', () => {
    expect(uuidv5(DERIVE_NAMESPACE, 'x'.repeat(500))).toBe('25f74609-119a-576a-9ee8-41820d7e1190')
  })

  it('pads correctly either side of a block boundary', () => {
    // 55 bytes of name plus the 16-byte namespace straddles the point where the
    // length suffix no longer fits in the final block and SHA-1 needs another.
    expect(uuidv5(DNS_NAMESPACE, 'y'.repeat(55))).toBe('a23983f2-93a4-5aaa-81c2-56b1af1c1d1c')
    expect(uuidv5(DNS_NAMESPACE, 'y'.repeat(56))).toBe('4d280fc6-b05a-5094-b818-94a93e901355')
  })

  it('hashes the UTF-8 bytes of a name, not its code units', () => {
    expect(uuidv5(DERIVE_NAMESPACE, 'crème fraîche')).toBe('a656da2f-437e-5810-be85-24e301a7388a')
    expect(uuidv5(DERIVE_NAMESPACE, 'crème fraîche')).not.toBe(uuidv5(DERIVE_NAMESPACE, 'creme fraiche'))
  })
})
