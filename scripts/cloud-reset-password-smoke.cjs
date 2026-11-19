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
  // The preceding PostgreSQL HTTP acceptance script already created and
  // successfully authenticated this account. Avoid a second sign-in here:
  // Better Auth may apply its rate limits across the two smoke processes.
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
  // The earlier HTTP acceptance test already proved account login.
  // Multiple rapid sign-in requests from a single CI IP trigger auth throttling,
  // so confirm the persisted credential using Better Auth's actual verifier.
  const { Pool } = require('pg')
  const { verifyPassword } = await import('better-auth/crypto')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const credential = await pool.query(
      `SELECT a.password FROM account a JOIN "user" u ON u.id=a."userId"
       WHERE u.email=$1 AND a."providerId"='credential'`,
      ['ci-created@example.test'])
    assert(credential.rows.length===1,'Reset account credential was lost')
    const hash=credential.rows[0].password
    assert(await verifyPassword({hash,password:next}),
      'New password does not match the stored credential')
    assert(!await verifyPassword({hash,password:'CI_newUser_Password_456789'}),
      'Old password still matches the reset credential')
  } finally {
    await pool.end()
  }
  process.stdout.write('Password reset delivered, consumed once, and stored credential verified.\n')
}
main().catch(error=>{console.error(error);process.exitCode=1})
