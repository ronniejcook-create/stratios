import { SignIn } from '@clerk/nextjs'
import { AuthFrame } from '@/components/AuthFrame'

export default function Page() {
  return (
    <AuthFrame title="Welcome back." text="Sign in to see your organization's portfolio.">
      <SignIn />
    </AuthFrame>
  )
}
