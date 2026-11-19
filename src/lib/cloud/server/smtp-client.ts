import { connect as tcpConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

type SmtpSocket = Socket | TLSSocket

export interface SmtpConnectionConfig {
  host: string
  port: number
  secure: boolean
  from: string
  username: string
  password?: string
}

export class MailTransportError extends Error {
  constructor(public readonly code: string, public readonly stage: string, public readonly smtpCode?: number) {
    super(code)
    this.name = 'MailTransportError'
  }
}

const MAX_RESPONSE = 32_768
const RESPONSE_TIMEOUT = 15_000
const CONNECTION_TIMEOUT = 15_000

function connectionFailure(error: unknown, stage: 'connect' | 'tls'): MailTransportError {
  if (error instanceof MailTransportError) return error
  const cause = error as NodeJS.ErrnoException
  const code = cause?.code ?? ''
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code)) {
    return new MailTransportError('SMTP_TLS_CERTIFICATE_ERROR', stage)
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new MailTransportError('SMTP_CONNECTION_TIMEOUT', stage)
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new MailTransportError('SMTP_DNS_FAILED', stage)
  }
  if (code === 'ECONNREFUSED') return new MailTransportError('SMTP_CONNECTION_REFUSED', stage)
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return new MailTransportError('SMTP_NETWORK_UNREACHABLE', stage)
  }
  return new MailTransportError(stage === 'tls' ? 'SMTP_TLS_FAILED' : 'SMTP_CONNECT_FAILED', stage)
}

function rejectedCode(stage: string, status: number): string {
  if (stage === 'auth') return status === 535 || status === 534 || status === 530
    ? 'SMTP_AUTH_FAILED' : 'SMTP_AUTH_UNSUPPORTED'
  if (stage === 'sender') return 'SMTP_SENDER_REJECTED'
  if (stage === 'recipient') return 'SMTP_RECIPIENT_REJECTED'
  if (stage === 'data' || stage === 'accepted') return 'SMTP_MESSAGE_REJECTED'
  if (stage === 'starttls') return 'SMTP_STARTTLS_FAILED'
  return 'SMTP_SERVER_REJECTED'
}

class Reader {
  private buffer = ''
  private readonly queued: string[] = []
  private waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private failure: Error | null = null

  constructor(private readonly socket: SmtpSocket) {
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
  }

  private clearTimer() {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
  }
  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    if (this.waiting) this.waiting.reject(error)
    this.waiting = null
    this.clearTimer()
  }
  private onError = (error: Error) => this.fail(connectionFailure(error, 'connect'))
  private onClose = () => this.fail(new MailTransportError('SMTP_CONNECTION_CLOSED', 'connection'))
  private onData = (chunk: Buffer) => {
    this.buffer += chunk.toString('utf8')
    if (this.buffer.length > MAX_RESPONSE) {
      this.fail(new MailTransportError('SMTP_RESPONSE_TOO_LARGE', 'response'))
      this.socket.destroy()
      return
    }
    let end = this.buffer.indexOf('\n')
    while (end !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      if (this.waiting) {
        const waiting = this.waiting
        this.waiting = null
        this.clearTimer()
        waiting.resolve(line)
      } else {
        this.queued.push(line)
      }
      end = this.buffer.indexOf('\n')
    }
  }

  private line(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.queued.length) return Promise.resolve(this.queued.shift()!)
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject }
      this.timeout = setTimeout(() => {
        this.fail(new MailTransportError('SMTP_RESPONSE_TIMEOUT', 'response'))
        this.socket.destroy()
      }, RESPONSE_TIMEOUT)
    })
  }

  async expect(allowed: number[], stage: string): Promise<{ status: number; lines: string[] }> {
    const lines: string[] = []
    let previous = 0
    for (let i = 0; i < 100; i++) {
      const line = await this.line()
      const match = /^(\d{3})([ -])/.exec(line)
      if (!match) throw new MailTransportError('SMTP_BAD_RESPONSE', stage)
      const status = Number(match[1])
      if (previous && status !== previous) throw new MailTransportError('SMTP_BAD_RESPONSE', stage)
      previous = status
      lines.push(line.slice(4))
      if (match[2] === ' ') {
        if (!allowed.includes(status)) throw new MailTransportError(rejectedCode(stage, status), stage, status)
        return { status, lines }
      }
    }
    throw new MailTransportError('SMTP_RESPONSE_TOO_LARGE', stage)
  }

  async command(command: string, allowed: number[], stage: string) {
    this.socket.write(command + '\r\n')
    return this.expect(allowed, stage)
  }
  detach() {
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    this.socket.off('close', this.onClose)
    this.clearTimer()
  }
}

function openSocket(host: string, port: number, secure: boolean): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized: true })
      : tcpConnect({ host, port })
    let settled = false
    const done = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) { socket.destroy(); reject(connectionFailure(error, secure ? 'tls' : 'connect')) }
      else resolve(socket)
    }
    const onError = (error: Error) => done(error)
    const onClose = () => done(new Error('connection closed'))
    const timer = setTimeout(() => done(new MailTransportError('SMTP_CONNECTION_TIMEOUT', 'connect')),
      CONNECTION_TIMEOUT)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.once(secure ? 'secureConnect' : 'connect', () => done())
  })
}

function startTls(socket: SmtpSocket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secured = tlsConnect({ socket, servername: host, rejectUnauthorized: true })
    let settled = false
    const done = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      secured.off('error', onError)
      secured.off('close', onClose)
      if (error) { secured.destroy(); reject(connectionFailure(error, 'tls')) }
      else resolve(secured)
    }
    const onError = (error: Error) => done(error)
    const onClose = () => done(new Error('TLS connection closed'))
    const timer = setTimeout(() => done(new MailTransportError('SMTP_CONNECTION_TIMEOUT', 'tls')),
      CONNECTION_TIMEOUT)
    secured.once('error', onError)
    secured.once('close', onClose)
    secured.once('secureConnect', () => done())
  })
}

function authMethods(lines: string[]): string[] {
  const row = lines.map(line => line.trim().toUpperCase())
    .find(line => line.startsWith('AUTH ') || line.startsWith('AUTH='))
  return row ? row.replace(/^AUTH[= ]/, '').split(/\s+/).filter(Boolean) : []
}

export async function sendSmtpMail(config: SmtpConnectionConfig, raw: string, recipient: string) {
  let socket = await openSocket(config.host, config.port, config.secure)
  let reader = new Reader(socket)
  let accepted = false
  try {
    await reader.expect([220], 'greeting')
    let hello = await reader.command('EHLO oc-studio.local', [250], 'ehlo')
    if (!config.secure) {
      if (!hello.lines.some(line => line.trim().toUpperCase() === 'STARTTLS')) {
        throw new MailTransportError('SMTP_STARTTLS_UNAVAILABLE', 'starttls')
      }
      await reader.command('STARTTLS', [220], 'starttls')
      reader.detach()
      socket = await startTls(socket, config.host)
      reader = new Reader(socket)
      hello = await reader.command('EHLO oc-studio.local', [250], 'ehlo')
    }
    if (config.username) {
      if (!config.password) throw new MailTransportError('SMTP_PASSWORD_MISSING', 'auth')
      const available = authMethods(hello.lines)
      if (available.includes('PLAIN')) {
        const credentials = Buffer.from('\0' + config.username + '\0' + config.password).toString('base64')
        const response = await reader.command('AUTH PLAIN ' + credentials, [235, 334], 'auth')
        if (response.status === 334) await reader.command(credentials, [235], 'auth')
      } else if (available.includes('LOGIN')) {
        await reader.command('AUTH LOGIN', [334], 'auth')
        await reader.command(Buffer.from(config.username).toString('base64'), [334], 'auth')
        await reader.command(Buffer.from(config.password).toString('base64'), [235], 'auth')
      } else {
        throw new MailTransportError('SMTP_AUTH_UNSUPPORTED', 'auth')
      }
    }
    await reader.command('MAIL FROM:<' + config.from + '>', [250], 'sender')
    await reader.command('RCPT TO:<' + recipient + '>', [250, 251], 'recipient')
    await reader.command('DATA', [354], 'data')
    const normalized = raw.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..')
    socket.write(normalized.replace(/\r\n$/, '') + '\r\n.\r\n')
    await reader.expect([250], 'accepted')
    accepted = true
    // Post-acceptance QUIT failure must not turn an accepted mail into a reported send failure.
    try { await reader.command('QUIT', [221], 'quit') } catch { /* accepted by SMTP server */ }
  } catch (error) {
    if (error instanceof MailTransportError) throw error
    throw connectionFailure(error, 'connect')
  } finally {
    reader.detach()
    socket.destroy()
  }
  return accepted
}
