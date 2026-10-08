import { SignUp } from '@clerk/nextjs'
import { AuthFrame } from '@/components/AuthFrame'

export default function Page() {
  return (
    <AuthFrame
      title="Sign up for Stratios."
      text="Create your account, then set up your organization or join the one your colleagues already use."
    >
      <SignUp />
    </AuthFrame>
  )
}
