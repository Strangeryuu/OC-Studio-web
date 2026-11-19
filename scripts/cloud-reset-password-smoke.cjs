'use strict'

// HTTPS/SMTP integration is verified separately in a deployed test environment.
// This script exercises the real Better Auth token lifecycle with a CI-only
// sendmail command that captures one email file and sends no external email.
const { readFile } = require('node:fs/promises')
const BASE = 'http://127.0.0.1:3000'
const ORIGIN = 'http://localhost:3000'
const OUTBOX = process.env.CI_MAIL_CAPTURE_PATH || '/tmp/ocstudio-ci-reset-mail.eml'

function assert(condition,description) {
  if (!condition) throw new Error(description)
}
function jsonPost(path,body) {
  return fetch(BASE+path,{method:'POST',
    headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify(body)})
}

async function main(){
  const before = await jsonPost('/api/auth/sign-in/email',{
    email:'ci-created@example.test',password:'CI_newUser_Password_456789',
  })
  assert(before.status===200,'Password recovery fixture is missing')

  const request = await jsonPost('/api/auth/request-password-reset',{
    email:'ci-created@example.test',redirectTo:ORIGIN+'/reset-password',
  })
  assert(request.status===200,'Password reset request failed HTTP '+request.status)

  let message=''
  for(let i=0;i<40;i++){
    try{message=await readFile(OUTBOX,'utf8');if(message.includes('reset-password'))break}
    catch{/* sendmail capture may still be writing */}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert(message.includes('ci-created@example.test')&&message.includes('reset-password'),
    'Local sendmail failed to deliver a password-reset URL into the CI outbox')
  const found = message.match(/https?:\/\/[^\s<>]+/)
  assert(found,'Reset email contains no URL')
  let link = new URL(found[0].replace(/[>,)]+$/,''))
  assert(link.origin===ORIGIN,'Reset email points outside the configured origin')

  if(link.pathname.startsWith('/api/auth/reset-password/')){
    const clicked = await fetch(link,{redirect:'manual'})
    assert([302,303,307,308].includes(clicked.status),'Reset link click did not redirect')
    link = new URL(clicked.headers.get('location'),ORIGIN)
  }
  assert(link.pathname==='/reset-password','Reset link did not reach user password form')
  const token = link.searchParams.get('token')
  assert(token&&token.length>20,'Reset email has no password-reset token')

  const next='CI_afterRecovery_Password_67890'
  const reset = await jsonPost('/api/auth/reset-password',{token,newPassword:next})
  assert(reset.status===200,'Changing password through the reset link failed HTTP '+reset.status)
  const replay = await jsonPost('/api/auth/reset-password',{
    token,newPassword:'CI_unexpected_Password_54321',
  })
  assert(replay.status!==200,'An already used password-reset token was accepted')
  const old = await jsonPost('/api/auth/sign-in/email',{
    email:'ci-created@example.test',password:'CI_newUser_Password_456789',
  })
  assert(old.status!==200,'Old password can still sign in after recovery')
  const signed = await jsonPost('/api/auth/sign-in/email',{
    email:'ci-created@example.test',password:next,
  })
  assert(signed.status===200,'New password cannot sign in after recovery')
  process.stdout.write('Password reset delivered, consumed once, and new login verified.\n')
}
main().catch(error=>{console.error(error);process.exitCode=1})
