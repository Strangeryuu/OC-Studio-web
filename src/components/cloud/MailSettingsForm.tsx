'use client'
import { useEffect, useState, type FormEvent } from 'react'
type Config={mode:'local'|'smtp';from:string;host:string;port:number;secure:boolean;username:string;passwordSet:boolean}
type LocalStatus={available:boolean;path:string}
type TestResult={accepted?:boolean;to?:string;error?:string;stage?:string;smtpCode?:number;retryAfter?:number}
const initial:Config={mode:'smtp',from:'',host:'',port:465,secure:true,username:'',passwordSet:false}
const reasons:Record<string,string>={
 MAIL_NOT_CONFIGURED:'请先保存发件设置。',
 MAIL_INVALID_SETTINGS:'邮件设置有误，请重新保存。',
 MAIL_INVALID_ADDRESS:'发件人或收件人邮箱地址无效。',
 MAIL_PASSWORD_DECRYPT_FAILED:'SMTP 密码解密失败，请重新填写 SMTP 授权码并保存，并检查 BETTER_AUTH_SECRET 是否变更。',
 SMTP_DNS_FAILED:'SMTP 主机名无法解析，请核对服务商 SMTP 地址。',
 SMTP_CONNECTION_TIMEOUT:'SMTP 连接超时，请检查 VPS 出站端口限制和防火墙。',
 SMTP_RESPONSE_TIMEOUT:'SMTP 服务器无响应，请检查服务器或服务商限制。',
 SMTP_CONNECTION_REFUSED:'SMTP 连接被拒绝，请核对 SMTP 主机和端口。',
 SMTP_NETWORK_UNREACHABLE:'VPS 无法访问 SMTP 网络，请检查云平台出站策略。',
 SMTP_CONNECT_FAILED:'SMTP 连接失败，请检查服务器网络设置。',
 SMTP_CONNECTION_CLOSED:'SMTP 服务器提前关闭连接，请核对 TLS 模式、端口和服务商限制。',
 SMTP_TLS_CERTIFICATE_ERROR:'SMTP TLS 证书验证失败，请使用服务商官方域名并检查系统时间。',
 SMTP_TLS_FAILED:'SMTP TLS 协商失败，请确认端口 465 使用直接 TLS，端口 587 使用 STARTTLS。',
 SMTP_STARTTLS_UNAVAILABLE:'该 SMTP 服务器不提供 STARTTLS，请尝试官方 465 端口并开启直接 TLS。',
 SMTP_STARTTLS_FAILED:'SMTP 服务器拒绝 STARTTLS 升级，请核对端口与服务商设置。',
 SMTP_AUTH_UNSUPPORTED:'SMTP 服务器没有启用受支持的 PLAIN/LOGIN 验证，请检查服务商设置。',
 SMTP_AUTH_FAILED:'SMTP 登录失败，请使用完整邮箱作为用户名及服务商颁发的授权码或应用密码。',
 SMTP_PASSWORD_MISSING:'缺少 SMTP 授权码或应用密码。',
 SMTP_SENDER_REJECTED:'SMTP 服务器拒绝发件地址，请设为已验证的发件邮箱。',
 SMTP_RECIPIENT_REJECTED:'SMTP 服务器拒绝收件地址，请确认管理员账户邮箱有效。',
 SMTP_MESSAGE_REJECTED:'SMTP 服务器拒绝邮件内容，请检查发送配额、域名验证和邮件策略。',
 SMTP_SERVER_REJECTED:'SMTP 服务器拒绝了请求，请根据返回错误码排查。',
 MAIL_LOCAL_EXECUTABLE_MISSING:'Web 容器内没有 Sendmail 程序，宿主机程序不会自动进入容器。建议采用 SMTP。',
 MAIL_LOCAL_EXECUTABLE_DENIED:'容器没有 Sendmail 执行权限。',
 MAIL_LOCAL_EXEC_FAILED:'容器中的 Sendmail 启动失败。',
 MAIL_LOCAL_SEND_FAILED:'Sendmail 未接受邮件，请检查容器内 MTA 配置和队列。',
 MAIL_LOCAL_TIMEOUT:'Sendmail 发送超时，请检查容器内 MTA。',
 MAIL_LOCAL_IO_FAILED:'Sendmail 输入失败。',
 MAIL_LOCAL_PATH_INVALID:'Sendmail 程序路径无效。',
 MAIL_TEST_RATE_LIMITED:'测试发送太频繁，请稍后重试。',
 MAIL_DELIVERY_FAILED:'邮件发送出现异常，请查看 Web 容器日志中 [ocstudio/mail-test] 的错误码。',
}
export function MailSettingsForm(){
 const [config,setConfig]=useState<Config>(initial)
 const [password,setPassword]=useState('')
 const [localStatus,setLocalStatus]=useState<LocalStatus|null>(null)
 const [loaded,setLoaded]=useState(false),[stored,setStored]=useState(false)
 const [busy,setBusy]=useState(false),[testing,setTesting]=useState(false)
 const [error,setError]=useState<string|null>(null),[testError,setTestError]=useState<string|null>(null)
 const [testSuccess,setTestSuccess]=useState<string|null>(null),[saved,setSaved]=useState(false)
 useEffect(()=>{
  let active=true
  void (async()=>{
   try{
    const response=await fetch('/api/admin/mail',{cache:'no-store'})
    if(!response.ok)throw Error('读取邮件设置失败')
    const data:{settings?:Config|null;localStatus?:LocalStatus}=await response.json()
    if(!active)return
    if(data.settings){setConfig(data.settings);setStored(true)}
    setLocalStatus(data.localStatus??null)
   }catch(e){if(active)setError(e instanceof Error?e.message:'读取失败')}
   finally{if(active)setLoaded(true)}
  })()
  return ()=>{active=false}
 },[])
 const patch=(change:Partial<Config>)=>{
  setConfig(current=>({...current,...change}));setStored(false);setSaved(false);setTestError(null);setTestSuccess(null)
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||testing)return
  setBusy(true);setSaved(false);setError(null)
  try{
   const response=await fetch('/api/admin/mail',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...config,password:password||undefined})})
   const result:{error?:string}=await response.json()
   if(!response.ok)throw Error(result.error??'保存失败')
   setPassword('')
   setConfig(current=>({...current,passwordSet:current.mode==='smtp'&&(current.passwordSet||!!password)}))
   setStored(true);setSaved(true)
  }catch(e){setError(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}
 }
 async function sendTest(){
  if(!stored||busy||testing)return
  setTesting(true);setTestError(null);setTestSuccess(null)
  try{
   const response=await fetch('/api/admin/mail/test',{method:'POST'})
   const result:TestResult=await response.json()
   if(!response.ok){
    const reason=reasons[result.error??'']??'测试邮件发送失败，请检查服务器日志。'
    const extra=(result.smtpCode?'（SMTP '+result.smtpCode+'）':'')+
      (result.retryAfter?'（'+result.retryAfter+' 秒后重试）':'')
    throw Error(reason+extra)
   }
   setTestSuccess('发件服务已接受测试邮件，收件地址：'+result.to+
    '。请检查收件箱和垃圾邮件。服务器接受邮件后仍可能出现投递延迟或退信。')
  }catch(e){setTestError(e instanceof Error?e.message:'测试发送失败')}finally{setTesting(false)}
 }
 return <section className="max-w-2xl space-y-4">
   <a href="/admin" className="text-sm underline">返回管理员菜单</a>
   <h1 className="text-2xl font-semibold">找回密码邮件设置</h1>
   <p className="text-sm opacity-70">推荐 SMTP：465 端口使用直接 TLS，587 使用 STARTTLS。密码一般需要使用服务商 SMTP 授权码或应用密码。</p>
   <form onSubmit={submit} className="grid gap-3 rounded-panel border border-[var(--oc-line)] p-5 text-sm">
    <label>发送方式<select className="mt-1 block w-full rounded-control border border-[var(--oc-line)] p-2 bg-transparent"
     value={config.mode} onChange={e=>patch({mode:e.target.value as Config['mode']})}>
     <option value="smtp">SMTP 邮件服务器（推荐）</option>
     <option value="local">本机 Sendmail（需在容器内配置）</option></select></label>
    <label>发件人邮箱<input type="email" required value={config.from} onChange={e=>patch({from:e.target.value})}
     className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
    {config.mode==='smtp'?<>
     <label>SMTP 主机<input required value={config.host} autoComplete="off" placeholder="smtp.example.com"
      onChange={e=>patch({host:e.target.value,passwordSet:false})}
      className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     <label>SMTP 端口<input required type="number" min={1} max={65535} value={config.port}
      onChange={e=>patch({port:Number(e.target.value)})}
      className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     <label className="flex items-center gap-2"><input type="checkbox" checked={config.secure}
      onChange={e=>patch({secure:e.target.checked,port:e.target.checked?465:587})}/>
      直接 TLS（通常 465）；取消则使用 STARTTLS（通常 587）</label>
     <label>SMTP 用户名<input value={config.username} autoComplete="username" placeholder="通常是完整发件邮箱"
      onChange={e=>patch({username:e.target.value,passwordSet:false})}
      className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     <label>SMTP 授权码 / 应用密码{config.passwordSet?'（已保存；留空继续沿用）':''}
      <input type="password" value={password} autoComplete="new-password"
       required={Boolean(config.username)&&!config.passwordSet}
       onChange={e=>{setPassword(e.target.value);setStored(false);setSaved(false)}}
       className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     <p className="text-xs opacity-70">发件人建议与认证邮箱一致，企业邮箱需要验证域名及 SPF/DKIM 等设置。</p>
    </>:<>
     <p className="text-xs opacity-70">Sendmail 必须在 Web Docker 容器内部可执行。检测路径：{localStatus?.path??'/usr/sbin/sendmail'}</p>
     {localStatus&&<p role="status" className={localStatus.available?'text-xs':'text-xs text-danger'}>
      {localStatus.available?'容器内有可执行的 Sendmail，仍需配置有效的邮件传输服务。':
       '容器内缺少 Sendmail，推荐切换 SMTP。'}</p>}
    </>}
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {saved&&<p role="status">设置已保存，可以发送测试邮件。</p>}
    <button disabled={busy||testing||!loaded} className="rounded-control bg-[var(--oc-ink)] p-3 text-[var(--oc-paper)]">
     {busy?'正在保存…':'保存邮件配置'}</button>
   </form>
   <section className="space-y-3 rounded-panel border border-[var(--oc-line)] p-5 text-sm">
    <h2 className="font-semibold">邮件投递测试</h2>
    <p className="opacity-70">测试邮件将发送到当前登录的站点管理员邮箱，测试过程中不会生成密码重置令牌。</p>
    {!stored&&<p className="text-xs opacity-70">请先保存邮件设置。</p>}
    <button type="button" disabled={!stored||busy||testing} onClick={()=>void sendTest()}
     className="rounded-control border border-[var(--oc-line)] px-4 py-2 disabled:opacity-50">
     {testing?'正在连接发件服务…':'发送测试邮件'}</button>
    {testError&&<p role="alert" className="text-danger">{testError}</p>}
    {testSuccess&&<p role="status">{testSuccess}</p>}
    <p className="text-xs opacity-70">SMTP 535 通常与授权码有关；超时常与 VPS 网络限制有关。服务器接受邮件后仍未收到，请检查服务商投递日志、垃圾邮件和域名信誉。</p>
   </section>
  </section>
}
