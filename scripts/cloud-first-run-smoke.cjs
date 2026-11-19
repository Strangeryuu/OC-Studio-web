'use strict'
const assert=(test,message)=>{if(!test)throw new Error(message)}
async function run(){
  const origin='http://localhost:3000'
  const base='http://127.0.0.1:3000'
  for(let i=0;i<50;i++){
    try{if((await fetch(base+'/api/setup')).ok)break}catch{}
    await new Promise(resolve=>setTimeout(resolve,500))
  }
  const status=await (await fetch(base+'/api/setup')).json()
  assert(status.required===true,'Fresh installation should start setup')
  const landing=await fetch(base+'/',{redirect:'manual'})
  assert(landing.headers.get('location')==='/setup','Homepage must open setup')
  const payload={name:'CI First Administrator',email:'ci-first@example.test',password:'CI_only_InitialAdmin_234567'}
  const submit=()=>fetch(base+'/api/setup',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify(payload)})
  const responses=await Promise.all([submit(),submit()])
  assert(responses.filter(r=>r.status===201).length===1,'First administrator creation failed')
  assert(responses.filter(r=>r.status===409).length===1,'Initial setup race was accepted')
  assert((await (await fetch(base+'/api/setup')).json()).required===false,'Initialization did not persist')
  const closed=await fetch(base+'/setup',{redirect:'manual'})
  assert(closed.headers.get('location')==='/login','Setup page was not closed')
  const auth=await fetch(base+'/api/auth/sign-in/email',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({email:payload.email,password:payload.password})})
  assert(auth.status===200,'New administrator cannot log in')
  process.stdout.write('First-run admin onboarding HTTP checks passed.\n')
}
run().catch(error=>{console.error(error);process.exitCode=1})
