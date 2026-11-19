import { ResetPassword } from '@/components/cloud/ResetPassword'
export default async function Page({searchParams}:{searchParams:Promise<{token?:string;error?:string}>}){
 const params=await searchParams
 return <main className="flex min-h-screen items-center justify-center p-6">
   <ResetPassword token={params.token??''} error={params.error??''}/></main>
}
