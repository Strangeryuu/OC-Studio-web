// @vitest-environment node
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import { chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const db=vi.hoisted(()=>({mode:'local',from:'no-reply@example.test'}))
vi.mock('@/lib/cloud/server/db',()=>({
  pool:{query:async()=>({rows:[{value:{mode:db.mode,from:db.from,
    host:'',port:587,secure:false,username:''}}]})}
}))
import { encryptMailPassword,decryptMailPassword,sendPasswordResetMail } from '@/lib/cloud/server/mailer'
describe('secure email reset delivery',()=>{
  let dir:string
  let previousPath:string|undefined
  let previousSecret:string|undefined
  beforeAll(()=>{
    previousPath=process.env.SENDMAIL_PATH
    previousSecret=process.env.BETTER_AUTH_SECRET
    process.env.BETTER_AUTH_SECRET='unit_tests_email_secret_long_enough_2026'
    dir=mkdtempSync(join(tmpdir(),'oc-mailer-test-'))
    const out=join(dir,'email.txt')
    const file=join(dir,'capture-mail')
    writeFileSync(file,`#!/usr/bin/env node
const fs=require('node:fs')
let raw=''
process.stdin.setEncoding('utf8')
process.stdin.on('data',chunk=>raw+=chunk)
process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(out)},raw))
`)
    chmodSync(file,0o700)
    process.env.SENDMAIL_PATH=file
  })
  afterAll(()=>{
    if(previousPath===undefined)delete process.env.SENDMAIL_PATH
    else process.env.SENDMAIL_PATH=previousPath
    if(previousSecret===undefined)delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET=previousSecret
    rmSync(dir,{recursive:true,force:true})
  })
  it('round-trips credentials through authenticated encryption',()=>{
    const original='Long_Smtp_Password_123!'
    const sealed=encryptMailPassword(original)
    expect(sealed).not.toContain(original)
    expect(decryptMailPassword(sealed)).toBe(original)
    expect(decryptMailPassword(encryptMailPassword(original))).toBe(original)
  })
  it('writes an actual reset message through the configured local sendmail executable',async()=>{
    const url='https://studio.example.test/reset-password?token=ci-test-token'
    await sendPasswordResetMail('recipient@example.test',url)
    const text=readFileSync(join(dir,'email.txt'),'utf8')
    expect(text).toContain('To: recipient@example.test')
    expect(text).toContain('From: no-reply@example.test')
    expect(text).toContain(url)
    expect(text).toContain('Subject: =?UTF-8?B?')
  })
  it('rejects newline-injected email and reset URLs',async()=>{
    await expect(sendPasswordResetMail('attacker@example.test\r\nBcc: hidden@example.test',
      'https://studio.example.test/reset-password?token=123')).rejects.toThrow('MAIL_INVALID_ADDRESS')
    await expect(sendPasswordResetMail('recipient@example.test',
      'https://studio.example.test/\r\nX-Injected: true')).rejects.toThrow('MAIL_INVALID_ADDRESS')
  })
})
