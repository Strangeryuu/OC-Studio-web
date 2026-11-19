import { createCipheriv,createDecipheriv,randomBytes,scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { MailTransportError, sendSmtpMail } from './smtp-client'
import { pool } from './db'

export type MailMode='local'|'smtp'
export interface MailPublic {
  mode:MailMode
  from:string
  host:string
  port:number
  secure:boolean
  username:string
  passwordSet:boolean
}
interface MailConfig extends Omit<MailPublic,'passwordSet'> {
  encryptedPassword?:string
}
const EMAIL=/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/

function smtpKey():Buffer{
  const secret=process.env.BETTER_AUTH_SECRET
  if(!secret||secret.length<32)throw Error('MAIL_ENCRYPTION_SECRET_MISSING')
  return scryptSync(secret,'oc-studio-mail-v1',32)
}
export function encryptMailPassword(clear:string):string{
  const iv=randomBytes(12)
  const cipher=createCipheriv('aes-256-gcm',smtpKey(),iv)
  const payload=Buffer.concat([cipher.update(clear,'utf8'),cipher.final()])
  return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64')
}
export function decryptMailPassword(encrypted:string):string{
  const bytes=Buffer.from(encrypted,'base64')
  if(bytes.length<28)throw Error('MAIL_SECRET_INVALID')
  const decipher=createDecipheriv('aes-256-gcm',smtpKey(),bytes.subarray(0,12))
  decipher.setAuthTag(bytes.subarray(12,28))
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')
}
export function validMailSettings(value:unknown):value is MailPublic{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const v=value as Record<string,unknown>
  return (v.mode==='local'||v.mode==='smtp')&&
    typeof v.from==='string'&&v.from.length<=254&&EMAIL.test(v.from)&&
    typeof v.host==='string'&&v.host.length<=253&&
    (v.mode==='local'||/^[a-z0-9.-]+$/i.test(v.host))&&
    Number.isSafeInteger(v.port)&&Number(v.port)>=1&&Number(v.port)<=65535&&
    typeof v.secure==='boolean'&&typeof v.username==='string'&&v.username.length<=254
}
export async function readMailSettings():Promise<MailConfig|null>{
  const result=await pool.query<{value:MailConfig}>(
    "SELECT value FROM site_settings WHERE key='mail' LIMIT 1")
  const config=result.rows[0]?.value
  if(!config)return null
  if(!validMailSettings(config))throw new MailTransportError('MAIL_INVALID_SETTINGS','config')
  return config
}
const noCRLF=(value:string)=>value.replace(/[\r\n\x00-\x1f]/g,' ').trim()
const subject=(s:string)=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?='

function message(from:string,to:string,heading:string,body:string):string{
  if(!EMAIL.test(from)||!EMAIL.test(to)||/[\r\n]/.test(from+to)||
      /[\r\n]/.test(heading)||body.length>8000)throw Error('MAIL_INVALID_ADDRESS')
  return ['From: '+noCRLF(from),'To: '+noCRLF(to),
    'Subject: '+subject(heading),
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit','',body].join('\r\n')
}
function resetMessage(from:string,to:string,url:string):string{
  if(!/^https?:\/\/\S+$/.test(url)||url.length>4000||
      /[\r\n\x00-\x1f]/.test(url))throw Error('MAIL_INVALID_ADDRESS')
  return message(from,to,'OC Studio 找回密码',
    '你收到一封 OC Studio 密码重置邮件。\r\n\r\n'+
    '请在一小时内使用以下链接修改密码：\r\n'+url+'\r\n\r\n'+
    '如果你未申请重置密码，可以忽略本邮件。')
}

export function sendmailExecutablePath():string {
  const path=process.env.SENDMAIL_PATH||'/usr/sbin/sendmail'
  if(!path.startsWith('/')||path.includes('..')||/[\r\n\x00]/.test(path))
    throw new MailTransportError('MAIL_LOCAL_PATH_INVALID','local')
  return path
}
export async function localMailStatus():Promise<{available:boolean;path:string}>{
  const path=sendmailExecutablePath()
  try {await access(path,constants.X_OK);return {available:true,path}}
  catch {return {available:false,path}}
}
async function sendLocal(raw:string){
  const binary=sendmailExecutablePath()
  await new Promise<void>((resolve,reject)=>{
    const proc=spawn(binary,['-t','-i'],{stdio:['pipe','ignore','pipe']})
    let settled=false
    let stderr=''
    const done=(error?:Error)=>{
      if(settled)return
      settled=true
      clearTimeout(timeout)
      if(error)reject(error)
      else resolve()
    }
    const timeout=setTimeout(()=>{
      proc.kill()
      done(new MailTransportError('MAIL_LOCAL_TIMEOUT','local'))
    },15000)
    proc.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(0,256)})
    proc.stdin.on('error',(error:NodeJS.ErrnoException)=>{
      done(new MailTransportError(error.code==='EPIPE'?'MAIL_LOCAL_SEND_FAILED':'MAIL_LOCAL_IO_FAILED','local'))
    })
    proc.on('error',(error:NodeJS.ErrnoException)=>{
      done(new MailTransportError(error.code==='ENOENT'?'MAIL_LOCAL_EXECUTABLE_MISSING':
        error.code==='EACCES'?'MAIL_LOCAL_EXECUTABLE_DENIED':'MAIL_LOCAL_EXEC_FAILED','local'))
    })
    proc.on('close',code=>{
      // A zero exit status only means the MTA accepted the message for delivery.
      done(code===0?undefined:new MailTransportError('MAIL_LOCAL_SEND_FAILED','local'))
    })
    proc.stdin.end(raw+'\r\n')
  })
}
async function deliver(config:MailConfig,raw:string,to:string){
  if(config.mode==='local') return sendLocal(raw)
  const password=config.encryptedPassword?decryptMailPassword(config.encryptedPassword):undefined
  await sendSmtpMail({
    host:config.host,port:config.port,secure:config.secure,
    from:config.from,username:config.username,password,
  },raw,to)
}
export async function sendPasswordResetMail(to:string,url:string):Promise<void>{
  const config=await readMailSettings()
  if(!config)throw new MailTransportError('MAIL_NOT_CONFIGURED','config')
  await deliver(config,resetMessage(config.from,to,url),to)
}
export async function sendMailTest(to:string):Promise<{mode:MailMode;from:string}>{
  const config=await readMailSettings()
  if(!config)throw new MailTransportError('MAIL_NOT_CONFIGURED','config')
  const raw=message(config.from,to,'OC Studio 邮件发送测试',
    '这是一封 OC Studio 邮件发送测试。\r\n\r\n'+
    '如果你收到了这封邮件，说明服务器与收件箱之间的投递链路已通畅。\r\n'+
    '邮件发送时间：'+new Date().toISOString()+'\r\n'+
    '若网页显示已提交但收件箱未收到，请检查垃圾邮件和发件服务商投递日志。')
  await deliver(config,raw,to)
  return {mode:config.mode,from:config.from}
}

/** Invite-only registration welcome message; uses the site's existing mail transport. */
export async function sendWelcomeMail(to: string, name: string): Promise<void> {
  const config = await readMailSettings()
  if (!config) throw new MailTransportError('MAIL_NOT_CONFIGURED', 'config')
  const displayName = noCRLF(name).slice(0, 100)
  const raw = message(config.from, to, '欢迎加入 OC Studio',
    '你好，' + displayName + '：\r\n\r\n' +
    '欢迎注册 OC Studio！你的账号已经创建成功。\r\n' +
    '现在可以登录，创建自己的世界观资料库，或加入受邀协作项目。\r\n\r\n' +
    '如这次注册并非由你发起，请联系站点管理员。\r\n\r\n' +
    '—— OC Studio')
  await deliver(config, raw, to)
}
