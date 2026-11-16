import { redirect } from 'next/navigation'

// OriginalHome remains intact while its local data layer is being adapted.
export default function StudioPage() {
  redirect('/')
}
