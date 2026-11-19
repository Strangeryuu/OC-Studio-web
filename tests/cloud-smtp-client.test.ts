// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const connector=vi.hoisted(()=>({
  create: (_kind:string):unknown=>{throw new Error('SMTP mock not initialized')},
}))
vi.mock('node:tls',()=>({connect: (...args:unknown[])=>connector.create('tls')}))
vi.mock('node:net',()=>({connect: (...args:unknown[])=>connector.create('net')}))
import { MailTransportError,sendSmtpMail } from '@/lib/cloud/server/smtp-client'

interface Scenario {
  mode:'direct'|'starttls'
  auth:'PLAIN'|'LOGIN'
  rejectAuth?:boolean
  commands:string[]
}
class FakeSocket extends EventEmitter {
  private authStep=0
  constructor(private scenario:Scenario,private secure:boolean){
    super()
    queueMicrotask(()=>this.emit(this.secure?'secureConnect':'connect'))
    if(!this.secure||scenario.mode==='direct')
      setTimeout(()=>this.reply('220 smtp.example.test ESMTP ready\r\n'),0)
  }
  private reply(data:string){queueMicrotask(()=>this.emit('data',Buffer.from(data)))}
  write(chunk:string|Buffer):boolean {
    const command=String(chunk).trim()
    this.scenario.commands.push(command)
    if(command.startsWith('EHLO')){
      const caps=this.secure
        ? '250-smtp.example.test\r\n250-AUTH '+this.scenario.auth+'\r\n250 SIZE 100000\r\n'
        : '250-smtp.example.test\r\n250-STARTTLS\r\n250 SIZE 100000\r\n'
      this.reply(caps)
    }else if(command==='STARTTLS')this.reply('220 Ready to start TLS\r\n')
    else if(command.startsWith('AUTH LOGIN')){
      this.authStep=1
      this.reply('334 VXNlcm5hbWU6\r\n')
    }else if(this.authStep===1){
      this.authStep=2
      this.reply('334 UGFzc3dvcmQ6\r\n')
    }else if(this.authStep===2){
      this.authStep=3
      this.reply(this.scenario.rejectAuth?'535 5.7.8 Authentication failed\r\n':'235 2.7.0 Accepted\r\n')
    }else if(command.startsWith('AUTH PLAIN')){
      this.reply(this.scenario.rejectAuth?'535 5.7.8 Authentication failed\r\n':'235 Authentication successful\r\n')
    }else if(command.startsWith('MAIL FROM'))this.reply('250 Sender OK\r\n')
    else if(command.startsWith('RCPT TO'))this.reply('250 Recipient OK\r\n')
    else if(command==='DATA')this.reply('354 End with CRLF dot CRLF\r\n')
    else if(command.endsWith('\r\n.'))this.reply('250 Queued\r\n')
    else if(command==='QUIT')this.reply('221 Closing\r\n')
    else throw new Error('Unexpected SMTP command (contents redacted)')
    return true
  }
  destroy():this {this.emit('close');return this}
}

function mock(scenario:Scenario){
  let nextIsUpgrade=false
  connector.create=(kind:string)=>{
    const isSecure=kind==='tls'
    if(isSecure&&scenario.mode==='starttls'){
      expect(nextIsUpgrade).toBe(false)
      nextIsUpgrade=true
    }
    return new FakeSocket(scenario,isSecure)
  }
}

const base={
  host:'smtp.example.test',port:465,secure:true,from:'sender@example.test',
  username:'sender@example.test',password:'app-password',
}
const raw='From: sender@example.test\r\nTo: destination@example.test\r\n\r\nMail body'

describe('SMTP protocol and authentication',()=>{
  it('uses AUTH LOGIN when the provider does not advertise AUTH PLAIN',async()=>{
    const scenario:Scenario={mode:'direct',auth:'LOGIN',commands:[]}
    mock(scenario)
    await expect(sendSmtpMail(base,raw,'destination@example.test')).resolves.toBe(true)
    expect(scenario.commands).toContain('AUTH LOGIN')
    expect(scenario.commands.some(line=>line.startsWith('MAIL FROM:<sender@example.test>'))).toBe(true)
    expect(scenario.commands.some(line=>line.startsWith('RCPT TO:<destination@example.test>'))).toBe(true)
    expect(scenario.commands.some(line=>line.endsWith('\r\n.'))).toBe(true)
  })
  it('upgrades via STARTTLS before AUTH PLAIN on port 587',async()=>{
    const scenario:Scenario={mode:'starttls',auth:'PLAIN',commands:[]}
    mock(scenario)
    await expect(sendSmtpMail({...base,port:587,secure:false},raw,'destination@example.test'))
      .resolves.toBe(true)
    expect(scenario.commands).toContain('STARTTLS')
    expect(scenario.commands.filter(line=>line.startsWith('EHLO'))).toHaveLength(2)
    expect(scenario.commands.some(line=>line.startsWith('AUTH PLAIN '))).toBe(true)
  })
  it('reports SMTP 535 without disclosing passwords',async()=>{
    const scenario:Scenario={mode:'direct',auth:'LOGIN',rejectAuth:true,commands:[]}
    mock(scenario)
    await expect(sendSmtpMail(base,raw,'destination@example.test'))
      .rejects.toMatchObject({code:'SMTP_AUTH_FAILED',smtpCode:535})
    const failure=new MailTransportError('SMTP_AUTH_FAILED','auth',535)
    expect(failure.message).not.toContain(base.password)
  })
})
