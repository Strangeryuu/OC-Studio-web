import { createCipheriv,createDecipheriv,randomBytes,scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { connect as tcpConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
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
const MAX_MESSAGE=15000

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
  return result.rows[0]?.value??null
}
const noCRLF=(value:string)=>value.replace(/[\r\n\x00-\x1f]/g,' ').trim()
const subject=(s:string)=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?='
function message(from:string,to:string,url:string):string{
  if(!EMAIL.test(from)||!EMAIL.test(to)||/\s/.test(url)||url.length>4000)throw Error('MAIL_INVALID_ADDRESS')
  const body='你收到一封 OC Studio 密码重置邮件。\r\n\r\n'+
    '请在一小时内使用以下链接修改密码：\r\n'+url+'\r\n\r\n'+
    '如果你未申请重置密码，可以忽略本邮件。'
  return ['From: '+noCRLF(from),'To: '+noCRLF(to),
    'Subject: '+subject('OC Studio 找回密码'),
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit','','',body].join('\r\n')
}
async function sendLocal(raw:string){
  // Explicit absolute path avoids executing user-provided binaries or a shell.
  const binary=process.env.SENDMAIL_PATH||'/usr/sbin/sendmail'
  if(!binary.startsWith('/')||binary.includes('..'))throw Error('MAIL_LOCAL_PATH_INVALID')
  await new Promise<void>((resolve,reject)=>{
    const proc=spawn(binary,['-t','-i'],{stdio:['pipe','ignore','pipe']})
    let error=''
    proc.stderr.on('data',(chunk:Buffer)=>{error+=chunk.toString().slice(0,512)})
    proc.on('error',reject)
    proc.on('close',code=>code===0?resolve():reject(Error('SENDMAIL_FAILED_'+code+' '+error.slice(0,80))))
    proc.stdin.end(raw+'\r\n')
  })
}
class SmtpReader {
  private pending:string[]=[]
  private waiter:((s:string)=>void)|null=null
  private buffer=''
  constructor(private socket:Socket|TLSSocket){
    socket.on('data',(chunk:Buffer)=>{
      this.buffer+=chunk.toString('utf8')
      if(this.buffer.length>MAX_MESSAGE){socket.destroy(Error('SMTP_RESPONSE_TOO_LARGE'));return}
      let end=this.buffer.indexOf('\n')
      while(end>=0){
        const line=this.buffer.slice(0,end).replace(/\r$/,'')
        this.buffer=this.buffer.slice(end+1)
        if(this.waiter){const done=this.waiter;this.waiter=null;done(line)}
        else this.pending.push(line)
        end=this.buffer.indexOf('\n')
      }
    })
  }
  private line():Promise<string>{
    if(this.pending.length)return Promise.resolve(this.pending.shift()!)
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.waiter=null;reject(Error('SMTP_TIMEOUT'))},12000)
      const finish=(s:string)=>{clearTimeout(timeout);resolve(s)}
      this.waiter=finish
    })
  }
  async reply(allowed:number[]){
    let status=0
    while(true){
      const line=await this.line()
      if(!/^\d{3}[ -]/.test(line))throw Error('SMTP_INVALID_REPLY')
      status=Number(line.slice(0,3))
      if(line[3]===' ')break
    }
    if(!allowed.includes(status))throw Error('SMTP_REJECTED_'+status)
  }
  async command(command:string,allowed:number[]){
    this.socket.write(command+'\r\n')
    await this.reply(allowed)
  }
}
function openSocket(host:string,port:number,secure:boolean):Promise<Socket|TLSSocket>{
  return new Promise((resolve,reject)=>{
    const socket=secure?tlsConnect({host,port,servername:host,rejectUnauthorized:true})
      :tcpConnect({host,port})
    socket.setTimeout(12000,()=>socket.destroy(Error('SMTP_TIMEOUT')))
    socket.once('error',reject)
    socket.once(secure?'secureConnect':'connect',()=>{socket.removeListener('error',reject);resolve(socket)})
  })
}
async function sendSmtp(config:MailConfig,raw:string,recipient:string){
  let socket=await openSocket(config.host,config.port,config.secure)
  try{
    let reader=new SmtpReader(socket)
    await reader.reply([220])
    await reader.command('EHLO oc-studio.local',[250])
    if(!config.secure){
      await reader.command('STARTTLS',[220])
      const encrypted=await new Promise<TLSSocket>((resolve,reject)=>{
        const tls=tlsConnect({socket,servername:config.host,rejectUnauthorized:true})
        tls.once('error',reject);tls.once('secureConnect',()=>resolve(tls))
      })
      socket=encrypted
      reader=new SmtpReader(socket)
      await reader.command('EHLO oc-studio.local',[250])
    }
    if(config.username){
      if(!config.encryptedPassword)throw Error('SMTP_PASSWORD_MISSING')
      const credentials=Buffer.from('\0'+config.username+'\0'+
        decryptMailPassword(config.encryptedPassword)).toString('base64')
      await reader.command('AUTH PLAIN '+credentials,[235])
    }
    await reader.command('MAIL FROM:<'+config.from+'>',[250])
    await reader.command('RCPT TO:<'+recipient+'>',[250,251])
    await reader.command('DATA',[354])
    socket.write(raw.replace(/\r?\n/g,'\r\n').replace(/(^|\r\n)\./g,'$1..')+'\r\n.\r\n')
    await reader.reply([250])
    await reader.command('QUIT',[221])
  }finally{socket.destroy()}
}
export async function sendPasswordResetMail(to:string,url:string):Promise<void>{
  const config=await readMailSettings()
  if(!config)throw Error('MAIL_NOT_CONFIGURED')
  const raw=message(config.from,to,url)
  if(config.mode==='local')await sendLocal(raw)
  else await sendSmtp(config,raw,to)
}
