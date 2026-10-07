import * as pgp from 'openpgp'

export interface KeyInfo {
  fingerprint: string
  emails: string[]
  publicKey: string
  binary: Uint8Array
  usable: boolean
  problem?: 'expired' | 'revoked' | 'unusable'
}
export interface PrivateRecord {
  privateKey: string
  publicKey: string
  fingerprint: string
  revocationCertificate?: string
  transferPreference?: boolean
}
const config: pgp.PartialConfig = {
  v6Keys: false,
  allowUnauthenticatedMessages: false,
  allowUnauthenticatedStream: false,
  maxDecompressedMessageSize: 64 * 1024 * 1024,
  aeadProtect: false,
  s2kType: pgp.enums.s2k.iterated,
  preferredSymmetricAlgorithm: pgp.enums.symmetric.aes256,
}
const normalize = (email: string) => email.trim().toLowerCase()

/** Runs only in the desktop's dedicated worker. Private key objects never leave it. */
export class CryptoEngine {
  private keys: pgp.PrivateKey[] = []
  async load(records: PrivateRecord[]) {
    const keys = await Promise.all(
      records.map((r) => pgp.readPrivateKey({ armoredKey: r.privateKey })),
    )
    if (keys.some((k) => !k.isDecrypted()))
      throw new Error('An imported private key is still locked.')
    this.keys = keys
  }
  lock() {
    this.keys = []
  }
  async inspect(data: string | Uint8Array, email?: string): Promise<KeyInfo[]> {
    if ((typeof data === 'string' ? data.length : data.byteLength) > 1024 * 1024)
      throw new Error('Key data is too large.')
    const keys = await (typeof data === 'string'
      ? pgp.readKeys({ armoredKeys: data })
      : pgp.readKeys({ binaryKeys: data }))
    if (!keys.length || keys.length > 20) throw new Error('No supported public key was found.')
    return Promise.all(
      keys.map(async (key) => {
        const emails: string[] = []
        // Only self-certified user IDs, not untrusted user-id packet text, establish an address.
        for (const user of key.users) {
          const address = user.userID?.email
          if (address) {
            try {
              await user.verify()
              emails.push(normalize(address))
            } catch {
              for (const certificate of user.selfCertifications) {
                try {
                  await user.verify(
                    new Date((certificate.created || key.getCreationTime()).getTime() + 1000),
                  )
                  emails.push(normalize(address))
                  break
                } catch {
                  /* Ignore uncertified IDs. */
                }
              }
            }
          }
        }
        if (email && !emails.includes(normalize(email)))
          throw new Error('This key does not match the email address.')
        let problem: KeyInfo['problem']
        if (await key.isRevoked()) problem = 'revoked'
        else {
          const expires = await key.getExpirationTime()
          if (expires !== Infinity && (!expires || expires <= new Date())) problem = 'expired'
          else
            try {
              await key.getEncryptionKey(
                undefined,
                new Date(),
                email ? { email: normalize(email) } : undefined,
              )
            } catch {
              problem = 'unusable'
            }
        }
        const publicKey = key.toPublic()
        return {
          fingerprint: key.getFingerprint(),
          emails: [...new Set(emails)],
          publicKey: publicKey.armor(),
          binary: publicKey.write(),
          usable: !problem,
          ...(problem ? { problem } : {}),
        }
      }),
    )
  }
  async autocryptKey(armoredKey: string, email: string): Promise<Uint8Array> {
    const key = await pgp.readKey({ armoredKey }),
      primary = await key.getPrimaryUser(undefined, { email: normalize(email) }),
      encryption = await key.getEncryptionKey(undefined, new Date(), { email: normalize(email) })
    if (!(encryption instanceof pgp.Subkey) || !primary.user.userID)
      throw new Error('Autocrypt requires an encryption subkey and an email user ID.')
    const packets = new pgp.PacketList<pgp.AnyPacket>()
    packets.push(
      key.toPublic().keyPacket,
      primary.user.userID,
      primary.selfCertification,
      encryption.keyPacket,
      await encryption.verify(),
    )
    return packets.write()
  }
  async mergePublic(old: string, incoming: string): Promise<string> {
    const key = await pgp.readKey({ armoredKey: old }),
      next = await pgp.readKey({ armoredKey: incoming })
    if (key.getFingerprint() !== next.getFingerprint())
      throw new Error('Different key fingerprints cannot be merged.')
    return (await key.update(next)).toPublic().armor()
  }
  async generate(name: string, email: string): Promise<PrivateRecord> {
    const result = await pgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name, email: normalize(email) }],
      subkeys: [{ curve: 'curve25519Legacy' }],
      format: 'armored',
      config,
    })
    const key = await pgp.readPrivateKey({ armoredKey: result.privateKey })
    return { ...result, fingerprint: key.getFingerprint() }
  }
  async importPrivate(
    armored: string,
    email: string,
    password?: string,
    historical = false,
  ): Promise<PrivateRecord> {
    if (armored.length > 1024 * 1024) throw new Error('Key data is too large.')
    let key = await pgp.readPrivateKey({ armoredKey: armored })
    if (!key.isDecrypted())
      key = await pgp.decryptKey({ privateKey: key, passphrase: password || '' })
    await this.inspect(key.toPublic().armor(), email)
    if (!historical) await key.getSigningKey(undefined, new Date(), { email: normalize(email) })
    return {
      privateKey: key.armor(),
      publicKey: key.toPublic().armor(),
      fingerprint: key.getFingerprint(),
    }
  }
  async backup(fingerprint: string, password: string): Promise<string> {
    if (password.length < 10) throw new Error('Use a backup password of at least 10 characters.')
    const key = this.keys.find((k) => k.getFingerprint() === fingerprint)
    if (!key) throw new Error('Unlock the vault containing this key.')
    return (await pgp.encryptKey({ privateKey: key, passphrase: password })).armor()
  }
  async revoke(fingerprint: string): Promise<string> {
    const key = this.keys.find((k) => k.getFingerprint() === fingerprint)
    if (!key) throw new Error('Unlock the vault containing this key.')
    return (await pgp.revokeKey({ key, format: 'armored' })).publicKey
  }
  async encrypt(
    data: Uint8Array,
    publicKeys: string[],
    signer?: string,
    hidden = false,
  ): Promise<string> {
    const encryptionKeys = await Promise.all(
      publicKeys.map((armoredKey) => pgp.readKey({ armoredKey })),
    )
    if (!encryptionKeys.length) throw new Error('No encryption keys are available.')
    const signingKey = signer ? this.keys.find((k) => k.getFingerprint() === signer) : undefined
    if (signer && !signingKey) throw new Error('Unlock the sender’s private key.')
    return pgp.encrypt({
      message: await pgp.createMessage({ binary: data }),
      encryptionKeys,
      ...(signingKey ? { signingKeys: signingKey } : {}),
      wildcard: hidden,
      format: 'armored',
      config,
    })
  }
  async sign(data: Uint8Array, fingerprint: string): Promise<string> {
    const key = this.keys.find((k) => k.getFingerprint() === fingerprint)
    if (!key) throw new Error('Unlock the sender’s private key.')
    return pgp.sign({
      message: await pgp.createMessage({ binary: data }),
      signingKeys: key,
      detached: true,
      format: 'armored',
      config: { ...config, preferredHashAlgorithm: pgp.enums.hash.sha256 },
    })
  }
  async verify(data: Uint8Array, signature: string, publicKeys: string[]) {
    const verificationKeys = await Promise.all(
      publicKeys.map((armoredKey) => pgp.readKey({ armoredKey })),
    )
    const result = await pgp.verify({
      message: await pgp.createMessage({ binary: data }),
      signature: await pgp.readSignature({ armoredSignature: signature }),
      verificationKeys,
      format: 'binary',
      config,
    })
    return this.signatures(result.signatures, verificationKeys)
  }
  private async signatures(signatures: pgp.VerifyMessageResult['signatures'], keys: pgp.Key[]) {
    return Promise.all(
      signatures.map(async (signature) => {
        const key = keys.find((k) =>
          k.getKeys().some((sub) => sub.getKeyID().equals(signature.keyID)),
        )
        let valid = false
        try {
          await signature.verified
          valid = true
        } catch {
          /* Signature warnings do not bypass message integrity. */
        }
        return { valid, fingerprint: key?.getFingerprint(), keyId: signature.keyID.toHex() }
      }),
    )
  }
  async decrypt(armored: string, publicKeys: string[]) {
    if (!this.keys.length)
      throw new Error(
        'No private key for this message is available. Import the original key or unlock the vault.',
      )
    const verificationKeys = await Promise.all(
      publicKeys.map((armoredKey) => pgp.readKey({ armoredKey })),
    )
    const result = await pgp.decrypt({
      message: await pgp.readMessage({ armoredMessage: armored }),
      decryptionKeys: this.keys,
      verificationKeys,
      format: 'binary',
      config,
    })
    return {
      data: result.data,
      signatures: await this.signatures(result.signatures, verificationKeys),
    }
  }
  async verifyInline(armored: string, publicKeys: string[]) {
    const verificationKeys = await Promise.all(
      publicKeys.map((armoredKey) => pgp.readKey({ armoredKey })),
    )
    const result = await pgp.verify({
      message: await pgp.readCleartextMessage({ cleartextMessage: armored }),
      verificationKeys,
      config,
    })
    return {
      text: result.data,
      signatures: await this.signatures(result.signatures, verificationKeys),
    }
  }
  async setupExport(fingerprint: string, code: string, prefer = false) {
    const key = this.keys.find((k) => k.getFingerprint() === fingerprint)
    if (!key) throw new Error('Unlock the key before transferring it.')
    const backup = key
      .armor()
      .replace(
        '-----BEGIN PGP PRIVATE KEY BLOCK-----\n',
        '-----BEGIN PGP PRIVATE KEY BLOCK-----\nAutocrypt-Prefer-Encrypt: ' +
          (prefer ? 'mutual' : 'nopreference') +
          '\n',
      )
    return pgp.encrypt({
      message: await pgp.createMessage({ text: backup }),
      passwords: [code],
      format: 'armored',
      config,
    })
  }
  async setupImport(armored: string, code: string, email: string) {
    const result = await pgp.decrypt({
      message: await pgp.readMessage({ armoredMessage: armored }),
      passwords: [code],
      format: 'utf8',
      config,
    })
    const record = await this.importPrivate(result.data, email, code)
    return {
      ...record,
      transferPreference: /^Autocrypt-Prefer-Encrypt:\s*mutual\s*$/m.test(result.data),
    }
  }
}
export type CryptoMethods = { [K in keyof CryptoEngine]: CryptoEngine[K] }
